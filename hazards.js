/* Sprite-alpha contact tests. Local gameplay only; never modifies the published wall colliders. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.TempleHazards=factory();})(globalThis,()=>{
  function create(meta,alpha,width,height,scale){
    const frameWidth=width/meta.frames;
    if(!Number.isInteger(frameWidth)||alpha.length!==width*height)throw new Error('Invalid hazard sprite sheet');
    const h={...meta,x:meta.center[0]*scale,y:meta.center[1]*scale,width:meta.size,height:meta.size*height/frameWidth};
    h.frame=(seconds=Date.now()/1000)=>Math.floor(seconds*meta.fps)%meta.frames;
    h.hit=(from,to,radius,frame)=>{
      const left=h.x-h.width/2,top=h.y-h.height/2,s=frameWidth/h.width;
      if(Math.max(from.x,to.x)+radius<left||Math.min(from.x,to.x)-radius>left+h.width||Math.max(from.y,to.y)+radius<top||Math.min(from.y,to.y)-radius>top+h.height)return false;
      const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/Math.max(1,radius/2)));
      for(let i=0;i<=steps;i++){
        const x=(from.x+(to.x-from.x)*i/steps-left)*s,y=(from.y+(to.y-from.y)*i/steps-top)*s,r=radius*s;
        for(let py=Math.max(0,Math.floor(y-r));py<=Math.min(height-1,Math.ceil(y+r));py++)for(let px=Math.max(0,Math.floor(x-r));px<=Math.min(frameWidth-1,Math.ceil(x+r));px++){
          if((px+.5-x)**2+(py+.5-y)**2<=r*r&&alpha[py*width+frame*frameWidth+px]>=160)return true;
        }
      }
      return false;
    };
    return h;
  }
  function fromImage(meta,image,scale){
    const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
    return {...create(meta,alpha,canvas.width,canvas.height,scale),image};
  }
  return {create,fromImage};
});
