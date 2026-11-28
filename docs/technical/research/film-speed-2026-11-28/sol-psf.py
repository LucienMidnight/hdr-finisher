import json,sys,numpy as np
K=json.load(open(sys.argv[1]))
radii=np.array([0,1,1.42,2,2.83,4,5.66,8,11.32,16,22.63,32,45.26,64,90.51,128,181.1])
def cdf(sigma,cap):
 R=min(int(3*sigma+.5),cap)
 x=np.arange(-R,R+1)
 k=np.exp(-.5*(x/sigma)**2) if sigma>0 else np.ones(1)
 k=k/k.sum()
 d=(x[None,:]**2+x[:,None]**2)**.5
 return np.array([(k[:,None]*k[None,:])[d<=r].sum() for r in radii])
def fit(A,y,indices):
 xx=A[:,indices]; w=np.zeros((len(indices),3))
 for c in range(3):
  active=list(range(len(indices)))
  while active:
   v=np.linalg.lstsq(xx[:,active],y[:,c],rcond=None)[0]
   if min(v)>=0:
    w[active,c]=v
    break
   active.pop(int(np.argmin(v)))
 w/=np.maximum(w.sum(axis=0,keepdims=True),1e-15)
 err=xx@w-y
 return (err**2).mean(),np.max(np.abs(err))*100,w
for name,data in zip(['Glimmerglass','Black Pro-Mist','Pro-Mist','CineBloom'],K[1:]):
 for w,h,src,grid in ((1283,856,6024,1),(1283,857,8660,1),(8660,5784,8660,4)):
  ppm=max(w/36,h/24)/grid
  cap=int(256*w/src/grid)
  s=np.array([x[0]*ppm/1000 for x in data]); wt=np.array([x[1] for x in data])
  target=np.column_stack([cdf(x,cap) for x in s])@wt
  candidate=np.unique(np.r_[0,s,np.geomspace(.25,max(s),30)])
  a=np.column_stack([cdf(x,cap) for x in candidate])
  ind=[]
  for i in range(6):
   ind=min((ind+[j] for j in range(len(candidate)) if j not in ind),key=lambda js:fit(a,target,js)[0])
   if i in (3,5):
    for step in range(3):
     for ii in range(1,len(ind)):
      ind=min((ind[:ii]+[j]+ind[ii+1:] for j in range(len(candidate)) if j not in ind or j==ind[ii]),key=lambda js:fit(a,target,js)[0])
    err,peak,b=fit(a,target,ind)
    tap=lambda ns:sum(2*min(int(x*3+.5),cap)+1 for x in ns)
    print(name,w,src,grid,len(ind),f'cdfRMSE={100*err**.5:.2f} pp max={peak:.2f} pp taps={tap(candidate[ind])}/{tap(s)}', 'sigs=',candidate[ind].round(2),'narrow energy=',wt[s<1,:].sum(0).round(3))
