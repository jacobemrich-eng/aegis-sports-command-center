const P=(name,aliases,opts={})=>({name,aliases:[name,...aliases],...opts});

// Original, lightweight park-identity profiles. These are presentation cues, not licensed
// stadium replicas. GameTwin still uses live MLB venue field dimensions when available.
export const PARK_PROFILES=[
P('Fenway Park',['Fenway'],{bowl:'intimate',foul:'tight',wall_heights:[37,18,12,8],landmarks:['tall_left_wall','manual_scoreboard','right_field_porch'],stand_tiers:2}),
P('Yankee Stadium',['Yankee Stadium III'],{bowl:'steep',foul:'tight',landmarks:['monument_strip','right_field_porch','facade'],stand_tiers:3}),
P('Wrigley Field',['Wrigley'],{bowl:'classic',foul:'tight',landmarks:['ivy_wall','bleachers','manual_scoreboard'],stand_tiers:2}),
P('Dodger Stadium',['Chavez Ravine'],{bowl:'symmetric',foul:'wide',landmarks:['terraced_outfield','mountain_backdrop','center_pavilions'],stand_tiers:4}),
P('Oracle Park',['AT&T Park','SBC Park','Pacific Bell Park'],{bowl:'waterfront',foul:'tight',landmarks:['right_field_water','brick_arcade','right_field_pole'],stand_tiers:3}),
P('Petco Park',['Petco'],{bowl:'urban',foul:'medium',landmarks:['left_field_building','park_at_park','downtown'],stand_tiers:3}),
P('Coors Field',['Coors'],{bowl:'open',foul:'wide',landmarks:['mountain_backdrop','rock_fountain','purple_seat'],stand_tiers:3}),
P('T-Mobile Park',['Safeco Field'],{bowl:'roofed',foul:'medium',landmarks:['retractable_roof','left_field_board','railroad_gap'],stand_tiers:3}),
P('Daikin Park',['Minute Maid Park','Enron Field'],{bowl:'roofed',foul:'tight',landmarks:['retractable_roof','left_field_train','brick_left_field'],stand_tiers:3}),
P('Globe Life Field',['Globe Life'],{bowl:'roofed',foul:'medium',landmarks:['retractable_roof','deep_left_center','large_video_board'],stand_tiers:4}),
P('American Family Field',['Miller Park'],{bowl:'roofed',foul:'wide',landmarks:['fan_roof','left_field_slide','outfield_panels'],stand_tiers:4}),
P('Busch Stadium',['Busch Stadium III'],{bowl:'urban',foul:'medium',landmarks:['center_scoreboard','city_arch_view','open_center'],stand_tiers:3}),
P('Great American Ball Park',['Great American'],{bowl:'riverfront',foul:'tight',landmarks:['river_gap','smokestacks','right_field_decks'],stand_tiers:3}),
P('PNC Park',['PNC'],{bowl:'riverfront',foul:'tight',landmarks:['bridge_view','riverfront','low_outfield'],stand_tiers:2}),
P('Oriole Park at Camden Yards',['Camden Yards','Oriole Park'],{bowl:'urban',foul:'tight',landmarks:['right_field_warehouse','brick_outfield','bullpen_deck'],stand_tiers:3}),
P('Citizens Bank Park',['Citizens Bank'],{bowl:'urban',foul:'medium',landmarks:['left_field_bell','ashburn_alley','center_board'],stand_tiers:3}),
P('Citi Field',['Citi'],{bowl:'urban',foul:'wide',landmarks:['left_rotunda','right_field_bridge','center_board'],stand_tiers:3}),
P('Nationals Park',['Nationals'],{bowl:'urban',foul:'medium',landmarks:['center_field_gate','right_field_decks','city_skyline'],stand_tiers:3}),
P('loanDepot park',['Marlins Park','LoanDepot Park'],{bowl:'roofed',foul:'medium',landmarks:['retractable_roof','left_field_windows','center_board'],stand_tiers:3}),
P('Truist Park',['SunTrust Park'],{bowl:'urban',foul:'medium',landmarks:['right_field_chophouse','left_field_board','mixed_use_backdrop'],stand_tiers:3}),
P('Kauffman Stadium',['The K'],{bowl:'open',foul:'wide',landmarks:['outfield_fountains','crown_board','grass_berm'],stand_tiers:2}),
P('Comerica Park',['Comerica'],{bowl:'urban',foul:'wide',landmarks:['deep_center','left_field_tigers','center_fountain'],stand_tiers:3}),
P('Progressive Field',['Jacobs Field','The Jake'],{bowl:'urban',foul:'medium',landmarks:['left_field_wall','center_board','right_field_corner'],stand_tiers:3}),
P('Target Field',['Target'],{bowl:'urban',foul:'medium',landmarks:['right_field_canopy','center_board','city_skyline'],stand_tiers:3}),
P('Rogers Centre',['SkyDome','Rogers Center'],{bowl:'roofed',foul:'wide',landmarks:['retractable_roof','center_hotel','large_outfield_board'],stand_tiers:4}),
P('Angel Stadium',['Angel Stadium of Anaheim','The Big A'],{bowl:'open',foul:'wide',landmarks:['rock_fountain','outfield_pavilions','right_field_sign'],stand_tiers:3}),
P('Chase Field',['Bank One Ballpark'],{bowl:'roofed',foul:'wide',landmarks:['retractable_roof','right_center_pool','large_center_board'],stand_tiers:4}),
P('Rate Field',['Guaranteed Rate Field','U.S. Cellular Field','Comiskey Park II'],{bowl:'open',foul:'medium',landmarks:['center_pinwheels','left_field_board','upper_deck'],stand_tiers:3}),
P('Sutter Health Park',['Raley Field'],{bowl:'minor_league_scale',foul:'tight',landmarks:['grass_berm','river_backdrop','low_outfield'],stand_tiers:2}),
P('Tropicana Field',['The Trop'],{bowl:'dome',foul:'wide',landmarks:['fixed_roof','catwalks','left_field_rotunda'],stand_tiers:3}),
P('George M. Steinbrenner Field',['Steinbrenner Field'],{bowl:'spring_training',foul:'tight',landmarks:['low_bowl','open_outfield','right_field_board'],stand_tiers:2})
];

function norm(s){return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();}
export function profileForVenue(name){const n=norm(name);if(!n)return null;let best=null,bestLen=0;for(const p of PARK_PROFILES){for(const a of p.aliases){const q=norm(a);if(q&&((n===q)||n.includes(q)||q.includes(n))&&q.length>bestLen){best=p;bestLen=q.length;}}}return best;}
export function parkProfileSummary(name){const p=profileForVenue(name);return p?{name:p.name,bowl:p.bowl,foul:p.foul,landmarks:[...(p.landmarks||[])],stand_tiers:p.stand_tiers||3,matched:true}:{name:name||'Generic MLB Park',bowl:'generic',foul:'medium',landmarks:['center_board'],stand_tiers:3,matched:false};}
export function listParkProfiles(){return PARK_PROFILES.map(p=>({name:p.name,aliases:[...p.aliases],bowl:p.bowl,foul:p.foul,landmarks:[...(p.landmarks||[])],stand_tiers:p.stand_tiers||3}));}
