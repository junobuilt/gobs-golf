// Golden-master fixtures — frozen active-player roster, exported READ-ONLY from
// prod on 2026-06-09 (the union of every active player + every participant in
// the golden rounds). Disambiguation in loadRoundResults reads the is_active
// subset, so freezing the roster keeps the goldens deterministic offline. CI
// never touches prod — these committed rows are the only source.

export type RosterPlayer = {
  id: number;
  full_name: string;
  display_name: string;
  is_active: boolean;
};

export const GOLDEN_ROSTER: RosterPlayer[] = [
  { id: 1, full_name: "Alan Williams", display_name: "Alan W", is_active: true },
  { id: 2, full_name: "Bill Taylor", display_name: "Bill T", is_active: true },
  { id: 3, full_name: "Bob Bezubiak", display_name: "Bob B", is_active: true },
  { id: 4, full_name: "Bob Pennell", display_name: "Bob P", is_active: true },
  { id: 5, full_name: "Chuck Boyles", display_name: "Chuck B", is_active: true },
  { id: 6, full_name: "Dan Green", display_name: "Dan G", is_active: true },
  { id: 7, full_name: "Dan Sofie", display_name: "Dan S", is_active: true },
  { id: 8, full_name: "Dave Vogt", display_name: "Dave V", is_active: true },
  { id: 9, full_name: "David Emmerson", display_name: "David E", is_active: true },
  { id: 10, full_name: "David Whitmore", display_name: "David W", is_active: true },
  { id: 11, full_name: "Don Davidson", display_name: "Don D", is_active: true },
  { id: 12, full_name: "Don Wright", display_name: "Don W", is_active: true },
  { id: 13, full_name: "Donald Pitt", display_name: "Donald P", is_active: true },
  { id: 14, full_name: "Drew Zogby", display_name: "Drew Z", is_active: true },
  { id: 15, full_name: "Eddie Agurkis", display_name: "Eddie A", is_active: true },
  { id: 17, full_name: "Gary Siemens", display_name: "Gary S", is_active: true },
  { id: 19, full_name: "Gerry Heys", display_name: "Gerry H", is_active: true },
  { id: 20, full_name: "Greg Wendt", display_name: "Greg W", is_active: true },
  { id: 21, full_name: "Hunter Lee", display_name: "Hunter L", is_active: true },
  { id: 22, full_name: "Jeff Irvin", display_name: "Jeff I", is_active: true },
  { id: 23, full_name: "Jim Treadway", display_name: "Jim T", is_active: true },
  { id: 24, full_name: "Kevin Ibatuan", display_name: "Kevin I", is_active: true },
  { id: 25, full_name: "Kurt Haggman", display_name: "Kurt H", is_active: true },
  { id: 26, full_name: "Mark Johnson", display_name: "Mark J", is_active: true },
  { id: 31, full_name: "Mike Windrim", display_name: "Mike Wi", is_active: true },
  { id: 32, full_name: "Nils Lazich", display_name: "Nils L", is_active: true },
  { id: 33, full_name: "Pat Tole", display_name: "Pat T", is_active: true },
  { id: 34, full_name: "Paul Hough", display_name: "Paul H", is_active: true },
  { id: 35, full_name: "Rick Collins", display_name: "Rick C", is_active: true },
  { id: 36, full_name: "Ron Lighterink", display_name: "Ron L", is_active: true },
  { id: 37, full_name: "Russ Crawford", display_name: "Russ C", is_active: true },
  { id: 38, full_name: "Sandy Fulton", display_name: "Sandy F", is_active: true },
  { id: 39, full_name: "Steve Davis", display_name: "Steve D", is_active: true },
  { id: 40, full_name: "Thomas Yang", display_name: "Thomas Y", is_active: true },
  { id: 41, full_name: "Tim Golden", display_name: "Tim G", is_active: true },
  { id: 42, full_name: "Tom Hanrahan", display_name: "Tom H", is_active: true },
  { id: 43, full_name: "Tony Jonker", display_name: "Tony J", is_active: true },
  { id: 44, full_name: "Ward Chapin", display_name: "Ward C", is_active: true },
  { id: 45, full_name: "Wayne Hashimoto", display_name: "Wayne H", is_active: true },
  { id: 46, full_name: "Gord McFarlane", display_name: "Gord M", is_active: true },
  { id: 48, full_name: "Joe Saletto", display_name: "Joe S", is_active: true },
  { id: 50, full_name: "Terry Mahoney", display_name: "Terry M", is_active: true },
  { id: 51, full_name: "John Faherty", display_name: "John F", is_active: true },
  { id: 52, full_name: "Jeff Dean", display_name: "Jeff D", is_active: true },
  { id: 55, full_name: "Wayne Vincent", display_name: "Wayne V", is_active: true },
  { id: 76, full_name: "Brian Powers", display_name: "Brian P", is_active: true },
  { id: 77, full_name: "Jim Metcalf", display_name: "Jim M", is_active: true },
  { id: 78, full_name: "John Milobar", display_name: "John Mi", is_active: true },
];
