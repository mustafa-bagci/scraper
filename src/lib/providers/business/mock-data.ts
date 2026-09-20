/**
 * Catalogue backing the MockBusinessProvider.
 *
 * Everything here is synthetic. Web addresses use the reserved `.example` TLD
 * (RFC 2606) so demo data can never cause a request to a real business.
 */

export type MockCategory = {
  slug: string;
  label: string;
  namePatterns: string[];
  roots: string[];
  /** Typical rating centre for the trade, used to shape the distribution. */
  ratingCentre: number;
};

export const MOCK_CATEGORIES: MockCategory[] = [
  {
    slug: 'dentiste',
    label: 'Dentiste',
    namePatterns: ['Cabinet Dentaire {root}', 'Centre Dentaire {root}', 'Dr {root} — Chirurgien-Dentiste'],
    roots: ['Dupont', 'Moreau', 'Lefèvre', 'Bernard', 'Rousseau', 'Girard', 'Chevalier', 'Perrin'],
    ratingCentre: 4.0,
  },
  {
    slug: 'restaurant',
    label: 'Restaurant',
    namePatterns: ['Restaurant {root}', 'Le {root}', 'Brasserie {root}', 'Chez {root}'],
    roots: ['Marais', 'Comptoir', 'Petit Four', 'Bouchon', 'Passage', 'Jardin', 'Quai', 'Terrasse'],
    ratingCentre: 4.1,
  },
  {
    slug: 'plombier',
    label: 'Plombier',
    namePatterns: ['{root} Plomberie', 'Plomberie {root}', 'SOS Plomberie {root}'],
    roots: ['Martin', 'Durand', 'Petit', 'Leroy', 'Garnier', 'Fontaine', 'Lambert'],
    ratingCentre: 3.7,
  },
  {
    slug: 'garage-automobile',
    label: 'Garage automobile',
    namePatterns: ['Garage {root}', 'Auto Services {root}', '{root} Automobiles'],
    roots: ['Mercier', 'Blanchard', 'Renard', 'Delaunay', 'Carrière', 'Vasseur'],
    ratingCentre: 3.9,
  },
  {
    slug: 'coiffeur',
    label: 'Coiffeur',
    namePatterns: ['Salon {root}', '{root} Coiffure', 'Atelier {root}'],
    roots: ['Éclat', 'Signature', 'Nuance', 'Studio 9', 'Miroir', 'Volume'],
    ratingCentre: 4.3,
  },
  {
    slug: 'avocat',
    label: 'Avocat',
    namePatterns: ['Cabinet {root} Avocats', 'Maître {root}', '{root} & Associés'],
    roots: ['Lemaire', 'Aubert', 'Colin', 'Marchand', 'Fournier', 'Dubois'],
    ratingCentre: 4.2,
  },
  {
    slug: 'hotel',
    label: 'Hôtel',
    namePatterns: ['Hôtel {root}', 'Hôtel Le {root}', '{root} Boutique Hôtel'],
    roots: ['Belvédère', 'Grand Pont', 'Central', 'Lumière', 'Rivage', 'Opéra'],
    ratingCentre: 4.0,
  },
  {
    slug: 'boulangerie',
    label: 'Boulangerie',
    namePatterns: ['Boulangerie {root}', 'Maison {root}', 'Au {root}'],
    roots: ['Levain', 'Fournil', 'Pain Doré', 'Épi', 'Grain', 'Tradition'],
    ratingCentre: 4.4,
  },
  {
    slug: 'agence-immobiliere',
    label: 'Agence immobilière',
    namePatterns: ['{root} Immobilier', 'Agence {root}', '{root} Patrimoine'],
    roots: ['Horizon', 'Clé de Voûte', 'Séquoia', 'Atrium', 'Boussole'],
    ratingCentre: 3.6,
  },
  {
    slug: 'salle-de-sport',
    label: 'Salle de sport',
    namePatterns: ['{root} Fitness', 'Club {root}', '{root} Training'],
    roots: ['Altitude', 'Forge', 'Cadence', 'Impulse', 'Sprint'],
    ratingCentre: 3.8,
  },
];

export type MockCity = {
  name: string;
  region: string;
  country: string;
  countryCode: string;
  postalPrefix: string;
  lat: number;
  lng: number;
};

export const MOCK_CITIES: MockCity[] = [
  { name: 'Lyon', region: 'Auvergne-Rhône-Alpes', country: 'France', countryCode: 'FR', postalPrefix: '690', lat: 45.764, lng: 4.8357 },
  { name: 'Paris', region: 'Île-de-France', country: 'France', countryCode: 'FR', postalPrefix: '750', lat: 48.8566, lng: 2.3522 },
  { name: 'Marseille', region: "Provence-Alpes-Côte d'Azur", country: 'France', countryCode: 'FR', postalPrefix: '130', lat: 43.2965, lng: 5.3698 },
  { name: 'Bordeaux', region: 'Nouvelle-Aquitaine', country: 'France', countryCode: 'FR', postalPrefix: '330', lat: 44.8378, lng: -0.5792 },
  { name: 'Lille', region: 'Hauts-de-France', country: 'France', countryCode: 'FR', postalPrefix: '590', lat: 50.6292, lng: 3.0573 },
  { name: 'Toulouse', region: 'Occitanie', country: 'France', countryCode: 'FR', postalPrefix: '310', lat: 43.6047, lng: 1.4442 },
  { name: 'Nantes', region: 'Pays de la Loire', country: 'France', countryCode: 'FR', postalPrefix: '440', lat: 47.2184, lng: -1.5536 },
  { name: 'Strasbourg', region: 'Grand Est', country: 'France', countryCode: 'FR', postalPrefix: '670', lat: 48.5734, lng: 7.7521 },
  { name: 'Bruxelles', region: 'Bruxelles-Capitale', country: 'Belgique', countryCode: 'BE', postalPrefix: '100', lat: 50.8503, lng: 4.3517 },
  { name: 'Anvers', region: 'Flandre', country: 'Belgique', countryCode: 'BE', postalPrefix: '200', lat: 51.2194, lng: 4.4025 },
  { name: 'Gand', region: 'Flandre', country: 'Belgique', countryCode: 'BE', postalPrefix: '900', lat: 51.0543, lng: 3.7174 },
  { name: 'Liège', region: 'Wallonie', country: 'Belgique', countryCode: 'BE', postalPrefix: '400', lat: 50.6326, lng: 5.5797 },
];

export const MOCK_STREETS = [
  'Rue de la République',
  'Avenue Jean Jaurès',
  'Boulevard Victor Hugo',
  'Rue Gambetta',
  'Place du Marché',
  'Rue des Tilleuls',
  'Avenue du Général Leclerc',
  'Quai des Célestins',
  'Rue Saint-Antoine',
  'Chaussée de Charleroi',
];

/** Synthetic review bodies, grouped by sentiment band. */
export const MOCK_REVIEW_TEXTS: Record<'low' | 'mid' | 'high', string[]> = {
  low: [
    'Rendez-vous annulé sans prévenir. Impossible de joindre le secrétariat, je ne reviendrai pas.',
    "Plus d'une heure d'attente malgré un rendez-vous fixé. Accueil désagréable.",
    'Tarifs bien supérieurs au devis annoncé. Aucune explication fournie.',
    'Travail bâclé, obligé de faire repasser un autre professionnel deux semaines plus tard.',
    'Aucune réponse à mes emails ni à mes appels depuis trois semaines. Très décevant.',
    'Prestation correcte mais le suivi après intervention est inexistant.',
  ],
  mid: [
    'Service correct dans l’ensemble, mais les délais annoncés ne sont pas tenus.',
    'Personnel compétent, locaux un peu vieillissants. Rapport qualité-prix moyen.',
    'Rien à redire sur la prestation, l’accueil pourrait être plus chaleureux.',
  ],
  high: [
    'Équipe très professionnelle, explications claires et travail soigné. Je recommande.',
    'Excellent accueil, rendez-vous obtenu rapidement. Parfait du début à la fin.',
    'Prestation impeccable et tarif conforme au devis. Merci pour votre réactivité.',
    'Très satisfait, intervention rapide et propre. Un vrai professionnel.',
  ],
};

export const MOCK_AUTHORS = [
  'Camille B.',
  'Julien M.',
  'Sophie L.',
  'Nicolas D.',
  'Émilie R.',
  'Thomas G.',
  'Laura P.',
  'Antoine V.',
  'Chloé F.',
  'Maxime T.',
];
