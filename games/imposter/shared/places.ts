// Spoken mode's places. Public on purpose: every player, the Imposter included,
// reads this list during play. Which one was dealt is the secret, and that
// stays on the server. Written for this project.
//
// Each place should answer "how long are you here?", "what are you wearing?"
// and "what can you hear?" differently from its neighbours, so a sharp
// question can split any two. No two cafés.

export interface Place {
  id: string;
  name: string;
}

export const PLACES: readonly Place[] = [
  { id: "sleeper-train", name: "Overnight sleeper train" },
  { id: "hospital-night", name: "Hospital night shift" },
  { id: "ferry", name: "Car ferry crossing" },
  { id: "airport-security", name: "Airport security queue" },
  { id: "space-station", name: "Space station" },
  { id: "submarine", name: "Submarine" },
  { id: "lighthouse", name: "Lighthouse" },
  { id: "ski-lift", name: "Ski lift" },
  { id: "campsite", name: "Rainy campsite" },
  { id: "wedding", name: "Wedding reception" },
  { id: "school-exam", name: "School exam hall" },
  { id: "dentist", name: "Dentist's waiting room" },
  { id: "car-wash", name: "Drive-through car wash" },
  { id: "bowling", name: "Bowling alley" },
  { id: "laundrette", name: "Late-night laundrette" },
  { id: "film-set", name: "Film set" },
  { id: "radio-studio", name: "Radio studio" },
  { id: "museum-lab", name: "Museum restoration lab" },
  { id: "observatory", name: "Mountain observatory" },
  { id: "aquarium", name: "Aquarium" },
  { id: "zoo-vet", name: "Zoo vet's surgery" },
  { id: "farm-milking", name: "Dairy farm at dawn" },
  { id: "fishing-boat", name: "Fishing boat" },
  { id: "beach-hut", name: "Beach hut" },
  { id: "theme-park", name: "Theme park queue" },
  { id: "haunted-house", name: "Ghost train ride" },
  { id: "circus", name: "Circus big top" },
  { id: "rooftop-garden", name: "Rooftop garden party" },
  { id: "food-truck", name: "Food truck" },
  { id: "bakery-4am", name: "Bakery at 4 a.m." },
  { id: "fire-station", name: "Fire station" },
  { id: "police-cell", name: "Police station front desk" },
  { id: "courtroom", name: "Courtroom" },
  { id: "polling-station", name: "Polling station" },
  { id: "library-silent", name: "Silent study library" },
  { id: "gym-class", name: "Spin class" },
  { id: "spa", name: "Hotel spa" },
  { id: "barber", name: "Barber's chair" },
  { id: "recording-booth", name: "Karaoke booth" },
  { id: "escape-room", name: "Escape room" },
  { id: "antarctic-base", name: "Antarctic research base" },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

/** The place with this id, or undefined. */
export const placeById = (id: string): Place | undefined => BY_ID.get(id);
