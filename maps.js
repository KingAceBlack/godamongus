/* One continuous world, using the supplied complete twin-chamber artwork unchanged. */
(function(root){
  const maps={
    'solar-temple':{
      id:'solar-temple',name:'Twin Sun Temple',image:'twin-temple.webp',colliders:'twin-temple-colliders.json',
      foreground:['twin-temple-front-v2.webp'],worldWidth:5200,sourceWidth:1906,sourceHeight:825,spawn:[316,525],
      hazards:[{id:'sunblade',name:'Sunblade',image:'sunblade-spin.webp',center:[1440,426],size:320,frames:8,fps:12}],
      areas:[
        {id:'entrance',name:'Entrance chamber',center:[316,401],size:[681,729]},
        {id:'sun-hall',name:'Sun Hall',center:[1437,413],size:[1100,825]}
      ]
    }
  };
  if(typeof module==='object'&&module.exports)module.exports=maps;else root.TempleMaps=maps;
})(globalThis);
