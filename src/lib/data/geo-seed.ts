// Geographic taxonomy for outbound filter scope. Nigeria is seeded
// fully (36 states + FCT). Additional countries can be added by the
// user via /settings/outbound-filters. The shape is { country,
// states[] } so a single tenant can scope to multiple regions
// (e.g. "Nigeria: Lagos, Abuja; Ghana: Accra").

export interface GeoRegion {
  country: string;
  states: string[];
}

export const NG_STATES_WITH_FCT: string[] = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa",
  "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti",
  "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano",
  "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

export const DEFAULT_GEO_SCOPE: GeoRegion[] = [
  { country: "Nigeria", states: [...NG_STATES_WITH_FCT] },
];
