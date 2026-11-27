/* A job may run indefinitely while work advances. Polling the queue is not work. */
(function(root){
  class DeliveryActivity {
    constructor(stall,{now=()=>performance.now(),every=setInterval,clear=clearInterval}={}) {
      this.now=now;this.clear=timer=>clear(timer);this.last=now();this.stopped=false;
      this.timer=every(()=>{if(!this.stopped&&now()-this.last>=60000){this.stop();stall();}},1000);
    }
    progress(){if(!this.stopped)this.last=this.now();}
    stop(){this.stopped=true;this.clear(this.timer);}
  }
  root.HDRDeliveryActivity=DeliveryActivity;
})(globalThis);
