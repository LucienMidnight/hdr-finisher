"""One CPU-only visible ARW picture; supervise its proportional resident peak."""
import json, os, subprocess, sys, tempfile, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))


def main():
    if len(sys.argv)>1 and sys.argv[1]=='--worker':
        from hdr_finisher.library_live import fallback_picture
        from hdr_finisher.delivery import preferences
        assert preferences()['effective_force_cpu']
        result=fallback_picture(sys.argv[2],sys.argv[3],None,640)
        print(json.dumps({'pictureReturned':result['url'].startswith('data:image/jpeg;base64,'),'gpuDisabled':True}))
        return
    from hdr_finisher.app_memory import process_tree
    photo=Path(sys.argv[1]).resolve(strict=True)
    output=Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='hdr-library-cpu-measure-') as directory:
        environment=dict(os.environ,HDR_FINISHER_FORCE_CPU_DELIVERY='1')
        started=time.monotonic();curve=[]
        with output.with_suffix('.log').open('w') as log:
            child=subprocess.Popen([sys.executable,__file__,'--worker',directory,str(photo)],env=environment,stdout=subprocess.PIPE,stderr=log,text=True)
            while child.poll() is None:
                rows=process_tree(child.pid)
                curve.append({'seconds':time.monotonic()-started,'bytes':sum(row['chargedBytes'] for row in rows)})
                time.sleep(.1)
            stdout=child.communicate()[0]
        result={'source':str(photo),'workingLimitBytes':600_000_000,'peakBytes':max(row['bytes'] for row in curve),'seconds':time.monotonic()-started,'exitCode':child.returncode,'curve':curve}
        if child.returncode==0:result.update(json.loads(stdout.splitlines()[-1]))
        result['pass']=child.returncode==0 and result['peakBytes']<=result['workingLimitBytes']
        output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({key:value for key,value in result.items() if key!='curve'}))
        if not result['pass']:sys.exit(1)


if __name__=='__main__':main()
