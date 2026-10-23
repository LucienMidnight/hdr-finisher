"""Float native Clone and boundary-matched Heal; no display pixels or search.

The tone correction is a harmonic field on a bounded grid (at most 128 per
axis); donor detail stays at native resolution. This is an independent
implementation of boundary-difference interpolation, not copied GIMP code.
"""
import numpy as np
from .retouch import RepairPatch
from .retouch_recipe import stroke_mask, InpaintRecipe


def _sample(image, yy, xx):
    """Bilinear sampling in native pixel coordinates, preserving HDR values."""
    h,w=image.shape[:2]
    yy=np.clip(yy,0,h-1);xx=np.clip(xx,0,w-1)
    y0=yy.astype(np.intp);x0=xx.astype(np.intp)
    y1=np.minimum(y0+1,h-1);x1=np.minimum(x0+1,w-1)
    fy=(yy-y0)[...,None];fx=(xx-x0)[...,None]
    return ((image[y0,x0]*(1-fx)+image[y0,x1]*fx)*(1-fy)+
            (image[y1,x0]*(1-fx)+image[y1,x1]*fx)*fy)


def _healing_field(difference, mask, checkpoint):
    height,width=mask.shape
    ys=np.linspace(0,height-1,min(height,128))
    xs=np.linspace(0,width-1,min(width,128))
    field=_sample(difference,ys[:,None],xs[None,:])
    unknown=mask[np.rint(ys).astype(int)[:,None],np.rint(xs).astype(int)[None,:]]>0
    # The outer image boundary is fixed, including repairs touching image edges.
    unknown[[0,-1],:]=False;unknown[:,[0,-1]]=False
    if unknown.any():
        # Initialize only from clean surrounding differences, never the defect.
        boundary=~unknown
        field[unknown]=field[boundary].mean(axis=0)
        # Solve the Dirichlet system with matrix-free conjugate gradients.
        # Texture never enters the iteration: only the smooth tone difference.
        wx=1/max(1,(width-1)/(len(xs)-1))**2
        wy=1/max(1,(height-1)/(len(ys)-1))**2
        diagonal=2*(wx+wy)
        core_mask=unknown[1:-1,1:-1]
        work=np.zeros_like(field)
        def neighbors(grid):
            return (wx*(grid[1:-1,2:]+grid[1:-1,:-2])+
                    wy*(grid[2:,1:-1]+grid[:-2,1:-1]))[core_mask]
        def apply(values):
            work[unknown]=values
            return diagonal*values-neighbors(work)
        boundary_field=field.copy();boundary_field[unknown]=0
        rhs=neighbors(boundary_field)
        solution=field[unknown].copy()
        residual=rhs-apply(solution)
        direction=residual.copy()
        dot=lambda a,b:np.einsum("ij,ij->j",a,b)
        squared=dot(residual,residual)
        tolerance=max(float(np.max(np.abs(field))),1.)*diagonal*1e-8
        for iteration in range(1200):
            if iteration%8==0: checkpoint()
            if np.max(np.abs(residual))<=tolerance: break
            product=apply(direction)
            denominator=dot(direction,product)
            step=np.divide(squared,denominator,out=np.zeros(3),where=denominator>0)
            solution+=direction*step
            residual-=product*step
            updated=dot(residual,residual)
            beta=np.divide(updated,squared,out=np.zeros(3),where=squared>0)
            direction=residual+direction*beta
            squared=updated
        else:
            raise ValueError("Healing did not converge; use a smaller stroke")
        field[unknown]=solution
    checkpoint()
    # Upsample only the smooth correction. Never resize donor texture.
    return field


def transfer_repair(recipe, base, checkpoint=lambda: None):
    recipe=InpaintRecipe.model_validate_json(recipe.model_dump_json())
    if recipe.mode not in ("clone","heal"):
        raise ValueError("Expected a Clone or Heal repair")
    checkpoint()
    alpha=stroke_mask(recipe,checkpoint)
    yy,xx=np.nonzero(alpha>0)
    x0=max(0,int(xx.min())-2);x1=min(alpha.shape[1],int(xx.max())+3)
    y0=max(0,int(yy.min())-2);y1=min(alpha.shape[0],int(yy.max())+3)
    left,top,_,_=recipe.search_rect
    alpha=alpha[y0:y1,x0:x1]
    left+=x0;top+=y0
    h,w=alpha.shape
    width,height=recipe.source_size
    dx=(recipe.source_point.x-recipe.points[0].x)*width
    dy=(recipe.source_point.y-recipe.points[0].y)*height
    sx=np.arange(left,left+w)[None,:]+dx
    sy=np.arange(top,top+h)[:,None]+dy
    valid=(sx>=0)&(sx<=width-1)&(sy>=0)&(sy<=height-1)
    if not valid[alpha>0].all():
        raise ValueError("The source brush crosses the photo edge; choose a source farther inside")
    original=base[top:top+h,left:left+w]
    donor=np.empty_like(original)
    for row in range(0,h,64):
        checkpoint()
        donor[row:row+64]=_sample(base,sy[row:row+64],sx)
    field=None
    if recipe.mode=="heal":
        field=_healing_field(original.astype(np.float64)-donor,alpha,checkpoint)
    result=np.empty_like(original)
    for row in range(0,h,64):
        checkpoint()
        filled=donor[row:row+64].astype(np.float64)
        if field is not None:
            fy=np.arange(row,min(row+64,h))[:,None]*(field.shape[0]-1)/max(h-1,1)
            fx=np.arange(w)[None,:]*(field.shape[1]-1)/max(w-1,1)
            filled+=_sample(field,fy,fx)
        blend=alpha[row:row+64,:,None].astype(np.float64)*recipe.strength
        result[row:row+64]=original[row:row+64].astype(np.float64)*(1-blend)+filled*blend
    checkpoint()
    if not np.isfinite(result).all(): raise ValueError("Repair produced non-finite pixels")
    result.setflags(write=False)
    empty=np.empty((0,2),np.int32)
    return RepairPatch((left,top),result,empty,empty),alpha>0
