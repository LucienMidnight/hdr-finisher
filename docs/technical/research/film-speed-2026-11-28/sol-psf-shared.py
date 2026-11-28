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

train = [(1283,856,6024,1,36,24,d) for d in (.5,1,2,4)] + [(1283,857,8660,1,36,24,d) for d in (.5,1,2,4)] + [(8660,5784,8660,4,36,24,d) for d in (.5,1,2,4)]
held = [(1283,856,6024,1,24.89,18.66,.75),(1283,857,8660,1,12.52,7.41,1.5),(6024,4020,6024,4,36,24,3)]
for name,data in zip(['Glimmerglass','Black Pro-Mist','Pro-Mist','CineBloom'],K[1:]):
 s=np.array([x[0] for x in data]); wt=np.array([x[1] for x in data])
 candidate=np.unique(np.r_[0,s,np.geomspace(min(s)*.8,max(s),32)])
 def build(conds):
  mats=[]; goals=[]
  for w,h,src,grid,gx,gy,size in conds:
   factor=max(w/gx,h/gy)/grid*size/1000
   cap=int(256*w/src/grid)
   goals.append(np.column_stack([cdf(x*factor,cap) for x in s])@wt)
   mats.append(np.column_stack([cdf(x*factor,cap) for x in candidate]))
  return np.vstack(mats),np.vstack(goals)
 a,y=build(train);b,z=build(held)
 ind=[]
 for i in range(8):
  ind=min((ind+[j] for j in range(len(candidate)) if j not in ind),key=lambda js:fit(a,y,js)[0])
  if i in (5,7):
   for step in range(3):
    for ii in range(len(ind)):
     ind=min((ind[:ii]+[j]+ind[ii+1:] for j in range(len(candidate)) if j not in ind or j==ind[ii]),key=lambda js:fit(a,y,js)[0])
   err,peak,w=fit(a,y,ind)
   ve=b[:,ind]@w-z
   print(name,len(ind),f'train={100*err**.5:.2f} pp rms/{peak:.2f} max; held={100*np.mean(ve*ve)**.5:.2f} pp rms/{100*np.max(np.abs(ve)):.2f} max', 'µm=',candidate[ind].round(2))
