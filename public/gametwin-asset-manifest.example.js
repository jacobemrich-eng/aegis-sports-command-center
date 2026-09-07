// GameTwin v1.7 high-fidelity asset manifest example.
// Keep these assets generic/original or properly licensed. This file intentionally ships with null URLs.
window.GameTwinAssetManifest={
  generic_player:{
    kind:'generic_player',
    lods:{low:null,medium:null,high:null},
    target_height_ft:6.15,
    anchor:'feet',
    max_triangles:{low:45000,medium:95000,high:180000},
    required_animations:['idle','run']
  },
  batter:{kind:'batter',lods:{low:null,medium:null,high:null},target_height_ft:6.1,required_animations:['idle','swing','run'],preferred_animations:['stance_left','stance_right','swing_load','swing_contact','swing_follow','trot','celebrate','react_strikeout','react_out']},
  pitcher:{kind:'pitcher',lods:{low:null,medium:null,high:null},target_height_ft:6.25,required_animations:['idle','pitch'],preferred_animations:['pitch_set','pitch_lift','pitch_drive','pitch_follow','celebrate']},
  fielder:{kind:'fielder',lods:{low:null,medium:null,high:null},target_height_ft:6.05,required_animations:['idle','run','field','throw','catch'],preferred_animations:['throw_infield','throw_outfield','celebrate']},
  runner:{kind:'runner',lods:{low:null,medium:null,high:null},target_height_ft:6.0,required_animations:['idle','run'],preferred_animations:['slide','trot','celebrate']},
  catcher:{kind:'catcher',lods:{low:null,medium:null,high:null},target_height_ft:6.0,required_animations:['idle','catch','throw'],preferred_animations:['receive','throw_catcher','celebrate']},
  umpire:{kind:'umpire',lods:{low:null,medium:null,high:null},target_height_ft:6.05,required_animations:['idle']},
  generic_stadium:{kind:'generic_stadium',lods:{low:null,medium:null,high:null},max_triangles:{low:180000,medium:420000,high:850000}},
  stadium_modules:{kind:'stadium_modules',lods:{low:null,medium:null,high:null},max_triangles:{low:90000,medium:220000,high:450000}}
};
