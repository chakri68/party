// Spoken mode's places. Public on purpose: every player, the Imposter included,
// reads this list during play. Which one was dealt is the secret, and that
// stays on the server. Written for this project.
//
// Each place should answer "how long are you here?", "what are you wearing?"
// and "what can you hear?" differently from its neighbours, so a sharp
// question can split any two. No two cafés.
//
// Kept clear of Spyfall's location tables, by name and by near paraphrase:
// no trains, hospitals, space stations, submarines, schools, studios, spas,
// circuses, polar bases, police stations, beaches, weddings, zoos, libraries,
// museums or theme parks. A test holds that line.

export interface Place {
  id: string;
  name: string;
}

export const PLACES: readonly Place[] = [
  { id: "late-taxi", name: "Taxi home at 3 a.m." },
  { id: "blood-donation", name: "Blood donation centre" },
  { id: "ferry", name: "Car ferry crossing" },
  { id: "airport-security", name: "Airport security queue" },
  { id: "hot-air-balloon", name: "Hot-air balloon basket" },
  { id: "narrowboat", name: "Canal narrowboat" },
  { id: "lighthouse", name: "Lighthouse" },
  { id: "ski-lift", name: "Ski lift" },
  { id: "campsite", name: "Rainy campsite" },
  { id: "fete-cake-stall", name: "Village fête cake stall" },
  { id: "driving-test", name: "Driving test" },
  { id: "dentist", name: "Dentist's waiting room" },
  { id: "car-wash", name: "Drive-through car wash" },
  { id: "bowling", name: "Bowling alley" },
  { id: "laundrette", name: "Late-night laundrette" },
  { id: "auction-house", name: "Auction house sale room" },
  { id: "radio-studio", name: "Radio studio" },
  { id: "clock-repair", name: "Clock repair workshop" },
  { id: "observatory", name: "Mountain observatory" },
  { id: "aquarium", name: "Aquarium" },
  { id: "dog-groomer", name: "Dog grooming salon" },
  { id: "farm-milking", name: "Dairy farm at dawn" },
  { id: "fishing-boat", name: "Fishing boat" },
  { id: "allotment-shed", name: "Allotment shed" },
  { id: "garden-centre", name: "Garden centre" },
  { id: "haunted-house", name: "Haunted house ride" },
  { id: "pottery-class", name: "Pottery class" },
  { id: "rooftop-garden", name: "Rooftop garden party" },
  { id: "food-truck", name: "Food truck" },
  { id: "bakery-4am", name: "Bakery at 4 a.m." },
  { id: "fire-station", name: "Fire station" },
  { id: "lost-property", name: "Lost property office" },
  { id: "courtroom", name: "Courtroom" },
  { id: "polling-station", name: "Polling station" },
  { id: "sorting-office", name: "Mail sorting office" },
  { id: "gym-class", name: "Spin class" },
  { id: "tattoo-parlour", name: "Tattoo parlour" },
  { id: "barber", name: "Barber's chair" },
  { id: "recording-booth", name: "Karaoke booth" },
  { id: "escape-room", name: "Escape room" },
  { id: "beehives", name: "Beekeeper's hives" },
];

const BY_ID = new Map(PLACES.map((p) => [p.id, p]));

/** The place with this id, or undefined. */
export const placeById = (id: string): Place | undefined => BY_ID.get(id);
