// Ville → Commune → Quartier lookup, shared across the app: patient
// registration (Accueil.jsx), facility location (SuperAdmin.jsx,
// AdminPanel.jsx), and prescription/lab-request routing (Doctor.jsx).
// Only Bamako has real data right now (all 6 communes with their actual
// quartiers) — every other ville is present (so it shows in Ville
// dropdowns) but maps to an empty object, which makes both Commune and
// Quartier fall back to free text for that ville until real data is
// added. Add a ville's communes/quartiers here as they become available —
// every screen that uses this file picks the change up automatically.
export const VILLES = {
  "Bamako": {
    "Commune I": ["Banconi", "Boulkassombougou", "Djélibougou", "Doumanzana", "Fadjiguila", "Sotuba", "Korofina Nord", "Korofina Sud", "Sikoroni"],
    "Commune II": ["Niaréla", "Bagadadji", "Médina-Coura", "Bozola", "Missira", "Hippodrome", "Quinzambougou", "Bakaribougou", "TSF", "Zone Industrielle", "Bougouba"],
    "Commune III": ["Dar Salam", "N'Tomikorobougou", "Wolofobougou-Bolibana", "Centre Commercial", "Bamako-Coura", "Dravela", "Badialan I", "Badialan II", "Badialan III", "Niominambougou", "Sogonifing", "Samé", "Sirakoro Dounfing", "Koulouba", "Point G", "Kodabougou", "Kouliniko"],
    "Commune IV": ["Lafiabougou", "Hamdallaye", "Dogoudouma", "Grimgoumo", "Lassa", "Taliko", "Sébénikoro", "Djicoroni-Para"],
    "Commune V": ["Badalabougou", "Sema I", "Quartier Mali", "Torokorobougou", "Baco-Djicoroni", "Sabalibougou", "Daoudabougou", "Kalaban-Coura"],
    "Commune VI": ["Sogoniko", "Magnambougou", "Banankabougou", "Faladié", "Dianéguéla", "Sokorodji", "Missabougou", "Niamakoro", "Yirimadio"],
  },
  "Ansongo": {}, "Baguinéda": {}, "Balandougou": {}, "Banamba": {}, "Banko": {},
  "Bandiagara": {}, "Bankass": {}, "Barouéli": {}, "Béma": {}, "Bla": {},
  "Boro": {}, "Bougouni": {}, "Bourem": {}, "Dandéresso": {}, "Diabali": {},
  "Diakon": {}, "Dialakorodji": {}, "Dialakoroba": {}, "Dialoubé": {}, "Diangouté Kamara": {},
  "Didiéni": {}, "Diéma": {}, "Dinangorou": {}, "Dioila": {}, "Diré": {},
  "Djenné": {}, "Djidian Kéniéba": {}, "Dogo": {}, "Douentza": {}, "Dougabougou": {},
  "Dyero": {}, "Falou": {}, "Fatimé": {}, "Fatoma": {}, "Fourou": {},
  "Gao": {}, "Garalo": {}, "Goundam": {}, "Gourma Rharous": {}, "Kaboïla": {},
  "Kadiolo": {}, "Kamabougou": {}, "Kangaba": {}, "Kati": {}, "Katiéna": {},
  "Kayes": {}, "Ké-Macina": {}, "Kébila": {}, "Kidal": {}, "Kignan": {},
  "Kita": {}, "Kléla": {}, "Kolokani": {}, "Kolondiéba": {}, "Kolongo-Bozo": {},
  "Kona": {}, "Konobougou": {}, "Konséguéla": {}, "Koro": {}, "Koulikoro": {},
  "Koumantou": {}, "Koumia": {}, "Kouoro": {}, "Kouri": {}, "Koutiala": {},
  "Kéniéba": {}, "Lobougoula": {}, "Macina": {}, "Madina Sako": {}, "Madougou": {},
  "Mahina": {}, "Markala": {}, "Massantola": {}, "Massigui": {}, "Ménaka": {},
  "Misséni": {}, "Moninnpébougou": {}, "Moribabougou": {}, "Mopti": {}, "Mpessoba": {},
  "Nara": {}, "Ngorkou": {}, "Niafunké": {}, "Niamina": {}, "Niéna": {},
  "Nioro": {}, "Niono": {}, "Ourikela": {}, "Pèlèngana": {}, "San": {},
  "Sanando": {}, "Sanankoroba": {}, "Sansanding": {}, "Sibi": {}, "Sikasso": {},
  "Sirakorola": {}, "Siribala": {}, "Sitakili": {}, "Sokolo": {}, "Sokoura": {},
  "Somasso": {}, "Ségala Mba": {}, "Ségou": {}, "Taoudenni": {}, "Ténenkou": {},
  "Timbuktu": {}, "Tominian": {}, "Tonka": {}, "Wolossébougou": {}, "Yanfolila": {},
  "Yélimané": {}, "Yorosso": {}, "Youwarou": {}, "Zinzana": {}, "Zégoua": {},
};