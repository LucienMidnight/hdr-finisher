(function () {
  'use strict';
  // Compact geometry only: masks are rasterized at the requested tile's
  // native pixel centres. Export remains the reference for unsupported forms.
  function eligible(expression, geometrySignature) {
    if (expression?.operator !== 'leaf' || expression.children?.length) return false;
    let geometry;
    try { geometry = JSON.parse(geometrySignature); } catch { return false; }
    const crop = geometry?.crop || {};
    if (![0,90,180,270].includes(Number(geometry?.rotation || 0))
      || Number(geometry?.straighten_angle || 0) || Number(geometry?.perspective_rotate || 0)
      || Number(geometry?.perspective_horizontal || 0) || Number(geometry?.perspective_vertical || 0)
      || Number(crop.x || 0) || Number(crop.y || 0)
      || Number(crop.width ?? 1) !== 1 || Number(crop.height ?? 1) !== 1) return false;
    const leaf = expression.leaf;
    if (leaf?.type === 'brush') return !Number(leaf.mask_feather || 0) && !Number(leaf.mask_shift_edge || 0);
    return leaf?.type === 'path';
  }

  function flatten(nodes = [], corresponding = []) {
    // Export evaluates each Bezier term in float32, including its partial
    // sums. Rounding only the final vertex moves native curved edges.
    const f = Math.fround, mul = (a,b) => f(a*b);
    const result = [];
    nodes.forEach((first, i) => {
      const second = nodes[(i + 1) % nodes.length];
      const pairs = [['out', first], ['in', second]];
      if (corresponding.length === nodes.length) pairs.push(['out',corresponding[i]],['in',corresponding[(i+1)%nodes.length]]);
      const curved = pairs.some(([handle, node]) =>
        ['x','y'].some(axis => node[`${handle}_${axis}`] != null && node[`${handle}_${axis}`] !== node[axis]));
      const count = curved ? 12 : 1;
      const a = [first.x, first.y].map(f), b = [first.out_x ?? first.x, first.out_y ?? first.y].map(f);
      const c = [second.in_x ?? second.x, second.in_y ?? second.y].map(f), d = [second.x, second.y].map(f);
      for (let j = 0; j < count; j++) {
        const t = f(j / count), u = f(1 - t);
        const weights = [f(u**3), mul(mul(3,f(u**2)),t), mul(mul(3,u),f(t**2)), f(t**3)];
        result.push([0,1].map(axis => f(f(f(mul(weights[0],a[axis]) + mul(weights[1],b[axis]))
          + mul(weights[2],c[axis])) + mul(weights[3],d[axis]))));
      }
    });
    return result;
  }

  function resample(vertices, count) {
    const lengths=vertices.map((p,i)=>Math.hypot(vertices[(i+1)%vertices.length][0]-p[0],vertices[(i+1)%vertices.length][1]-p[1]));
    const perimeter=lengths.reduce((a,b)=>a+b,0);
    if(perimeter<=1e-12)return Array.from({length:count},()=>vertices[0]);
    return Array.from({length:count},(_,i)=>{
      let distance=perimeter*i/count,index=0;
      while(index<lengths.length-1&&distance>=lengths[index])distance-=lengths[index++];
      const t=distance/Math.max(lengths[index],1e-12),a=vertices[index],b=vertices[(index+1)%vertices.length];
      return a.map((v,axis)=>v+t*(b[axis]-v));
    });
  }

  function parameters(expression, rect, width, height, geometrySignature = '{}') {
    const geometry = JSON.parse(geometrySignature), rotation = Number(geometry.rotation || 0) / 90;
    const outputWidth = width, outputHeight = height;
    if (rotation % 2) [width,height] = [height,width];
    const sourcePoint = (x,y) => {
      if (geometry.flip_horizontal) x = outputWidth-x;
      if (geometry.flip_vertical) y = outputHeight-y;
      if (rotation === 1) return [y,height-x];
      if (rotation === 2) return [width-x,height-y];
      if (rotation === 3) return [width-y,x];
      return [x,y];
    };
    const corners = [[rect.x,rect.y],[rect.x+rect.width,rect.y],
      [rect.x,rect.y+rect.height],[rect.x+rect.width,rect.y+rect.height]].map(([x,y])=>sourcePoint(x,y));
    const sourceRect = {x:Math.min(...corners.map(p=>p[0])),y:Math.min(...corners.map(p=>p[1])),
      right:Math.max(...corners.map(p=>p[0])),bottom:Math.max(...corners.map(p=>p[1]))};
    const leaf = expression.leaf, brush = leaf.type === 'brush';
    const header = [brush ? 0 : 1, rect.x, rect.y, width, height,
      expression.inverted ? 1 : 0, expression.enabled === false ? 0 : 1, 0, Number(leaf.feather || 0),
      rotation + (geometry.flip_horizontal?4:0) + (geometry.flip_vertical?8:0)];
    const values = [];
    if (!brush) {
      if ((leaf.nodes || []).length > 2048) return null;
      const outerMode=leaf.feather_mode==='outer_boundary' && (leaf.feather_nodes?.length || Number(leaf.feather)>0);
      const paired=outerMode && leaf.feather_nodes?.length===leaf.nodes?.length;
      const vertices = flatten(leaf.nodes,paired?leaf.feather_nodes:[]);
      if (vertices.length > 2048) return null;
      header[7] = vertices.length;
      if(outerMode){
        header[0]=2;
        let outer=leaf.feather_nodes?.length?flatten(leaf.feather_nodes,paired?leaf.nodes:[]):null;
        if(outer&&outer.length!==vertices.length)outer=resample(outer,vertices.length);
        const f=Math.fround,aspect=width/height,metric=[f(Math.max(aspect,1)),f(Math.max(1/aspect,1))];
        const points=vertices.map(p=>p.map((v,axis)=>f(v*metric[axis])));
        const area=points.reduce((sum,p,i)=>f(sum+f(f(p[0]*points[(i+1)%points.length][1])-f(points[(i+1)%points.length][0]*p[1]))),0);
        const orientation=area>=0?1:-1;
        values.push(Number(leaf.feather_softness??1));
        vertices.forEach((vertex,i)=>{
          const a=points[i],b=points[(i+1)%points.length],dx=f(b[0]-a[0]),dy=f(b[1]-a[1]),length=Math.max(Math.hypot(dx,dy),1e-8);
          const normal=[f(orientation*dy/f(length)),f(orientation*-dx/f(length))];
          const band=j=>outer?Math.max(f(f(f(outer[j][0]*metric[0])-points[j][0])*normal[0])+f(f(f(outer[j][1]*metric[1])-points[j][1])*normal[1]),1e-6):Math.max(Number(leaf.feather),1e-6);
          values.push(...vertex,band(i),band((i+1)%vertices.length));
        });
      }else vertices.forEach(vertex => values.push(...vertex));
    } else {
      const aspect = height / width;
      let segments = 0;
      for (const stroke of leaf.strokes || []) {
        const points = stroke.points || [], shapes = [];
        if (points.length > 2049) return null;
        if (points.length === 1) {
          const p = points[0]; shapes.push([p.x, p.y*aspect, p.x, p.y*aspect, stroke.radius*(p.pressure ?? 1)]);
        } else for (let i = 1; i < points.length; i++) {
          const a = points[i-1], b = points[i];
          shapes.push([a.x,a.y*aspect,b.x,b.y*aspect,stroke.radius*Math.max(.05,((a.pressure ?? 1)+(b.pressure ?? 1))*.5)]);
        }
        if (!shapes.length) continue;
        const minX = Math.min(...shapes.map(s=>Math.min(s[0],s[2])-s[4]));
        const maxX = Math.max(...shapes.map(s=>Math.max(s[0],s[2])+s[4]));
        const minY = Math.min(...shapes.map(s=>Math.min(s[1],s[3])-s[4]));
        const maxY = Math.max(...shapes.map(s=>Math.max(s[1],s[3])+s[4]));
        const bounds = [Math.max(0,Math.floor(minX*width-.5)-1),Math.max(0,Math.floor(minY*width-.5)-1),
          Math.min(width,Math.ceil(maxX*width-.5)+2),Math.min(height,Math.ceil(maxY*width-.5)+2)];
        if (bounds[2] <= sourceRect.x || bounds[3] <= sourceRect.y
          || bounds[0] >= sourceRect.right || bounds[1] >= sourceRect.bottom) continue;
        segments += shapes.length;
        if (segments > 2048) return null;
        header[7]++;
        values.push(shapes.length,Number(stroke.hardness ?? .75),Number(stroke.flow ?? 1),Number(stroke.opacity ?? 1),stroke.erase?1:0,...bounds,0);
        shapes.forEach(shape=>values.push(...shape));
      }
    }
    return new Float32Array([...header,...values]);
  }
  const HDRMaskRaster = Object.freeze({eligible,flatten,parameters});
  if (typeof window !== 'undefined') window.HDRMaskRaster = HDRMaskRaster;
  if (typeof module !== 'undefined' && module.exports) module.exports = {HDRMaskRaster};
})();
