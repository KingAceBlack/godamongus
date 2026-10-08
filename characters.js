/* Shared selection/rendering metadata and server-approved character IDs. */
(function(root){
  const characters={
    'sun-priestess':{name:'Sun Priestess',role:'Lightkeeper',idle:'priestess-idle-lossless.webp',walk:'priestess-walk-v2.webp'},
    'solar-guardian':{name:'Solar Guardian',role:'Temple Vanguard',idle:'guardian-idle.webp',walk:'guardian-walk-v2.webp'},
    'ember-warden':{name:'Ember Warden',role:'Flamekeeper',idle:'ember-idle.webp',walk:'ember-walk-v2.webp'},
    'dawn-sovereign':{name:'Dawn Sovereign',role:'Dawnkeeper',idle:'dawn-idle.webp',walk:'dawn-walk-v2.webp'},
    'solstice-keeper':{name:'Solstice Keeper',role:'Giftkeeper',idle:'solstice-idle.webp',walk:'solstice-walk-v2.webp'},
    'crimson-sentinel':{name:'Crimson Sentinel',role:'Temple Champion',idle:'crimson-idle.webp',walk:'crimson-walk-v2.webp'},
    'golden-envoy':{name:'Golden Envoy',role:'Gilded Traveler',idle:'envoy-idle.webp',walk:'envoy-walk-v2.webp',jump:'envoy-jump.webp'}
  };
  if(typeof module==='object'&&module.exports)module.exports=characters;else root.TempleCharacters=characters;
})(globalThis);
