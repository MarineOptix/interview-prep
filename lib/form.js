/** Field options and validation for the resume and vacancy forms. */

export const VESSEL_TYPES = [
  'Bulk carrier',
  'Oil tanker',
  'Product tanker',
  'Chemical tanker',
  'LNG carrier',
  'LPG carrier',
  'Container ship',
  'General cargo',
  'Ro-Ro / car carrier',
  'Reefer',
  'Passenger / cruise',
  'Ferry',
  'Offshore (PSV / AHTS)',
  'Tug',
  'Dredger',
];

export const CERTIFICATES = [
  'STCW Basic Safety Training',
  'Proficiency in Survival Craft and Rescue Boats',
  'Advanced Fire Fighting',
  'Medical First Aid / Medical Care',
  'Security Awareness / Designated Security Duties',
  'Ship Security Officer',
  'Basic Oil and Chemical Tanker Cargo Operations',
  'Advanced Oil Tanker Cargo Operations',
  'Advanced Chemical Tanker Cargo Operations',
  'Basic / Advanced Liquefied Gas Tanker Cargo Operations',
  'GMDSS General Operator',
  'ECDIS (generic and type-specific)',
  'Bridge / Engine Resource Management',
  'High Voltage',
  'Dynamic Positioning',
  'Ship’s Cook certificate',
];

export const ENGLISH_LEVELS = ['Basic', 'Intermediate', 'Upper-intermediate', 'Fluent'];

const LIMITS = { short: 120, medium: 400, long: 2500, table: 3000 };

function str(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max);
}

function list(v, allowed, max = 20) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => typeof x === 'string' && allowed.includes(x)))].slice(0, max);
}

function num(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || v === '' || v === null) return null;
  return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
}

/**
 * Normalises the profile sent to the LLM. The candidate's name is never part of it:
 * the client keeps the name locally and this function would drop it anyway.
 * Returns { profile, errors }.
 */
export function cleanProfile(input, positions) {
  const r = input?.resume ?? {};
  const v = input?.vacancy ?? {};
  const target = positions.find((p) => p.slug === r.targetPosition);

  const resume = {
    targetPosition: target?.title ?? '',
    slug: target?.slug ?? '',
    department: target?.department ?? '',
    currentRank: str(r.currentRank, LIMITS.short),
    vesselTypes: list(r.vesselTypes, VESSEL_TYPES),
    otherVesselTypes: str(r.otherVesselTypes, LIMITS.short),
    yearsAtSea: num(r.yearsAtSea, 0, 60),
    yearsInRank: num(r.yearsInRank, 0, 60),
    certificates: list(r.certificates, CERTIFICATES, 30),
    otherCertificates: str(r.otherCertificates, LIMITS.medium),
    englishLevel: ENGLISH_LEVELS.includes(r.englishLevel) ? r.englishLevel : '',
    marlinsScore: num(r.marlinsScore, 0, 100),
    duties: str(r.duties, LIMITS.long),
    // Sea service record, one vessel per line (typed by the candidate or filled from an uploaded CV).
    seaService: str(r.seaService, LIMITS.table),
  };

  const vacancy = {
    vesselType: VESSEL_TYPES.includes(v.vesselType) ? v.vesselType : str(v.vesselType, LIMITS.short),
    vesselSize: str(v.vesselSize, LIMITS.short),
    mainEngine: resume.department === 'engine' ? str(v.mainEngine, LIMITS.short) : '',
    tradingArea: str(v.tradingArea, LIMITS.short),
    contractLength: str(v.contractLength, LIMITS.short),
    company: str(v.company, LIMITS.short),
    requirements: str(v.requirements, LIMITS.long),
  };

  const errors = [];
  if (!target) errors.push('Choose the position you are applying for.');
  if (!resume.currentRank) errors.push('Choose your current or last rank.');
  if (!resume.vesselTypes.length && !resume.otherVesselTypes) errors.push('Choose at least one vessel type you have served on.');
  if (resume.yearsAtSea === null) errors.push('Enter your total sea service in years.');
  if (resume.duties.length < 40 && resume.seaService.length < 40) {
    errors.push('Describe your duties and achievements in a couple of sentences, or fill in your sea service record.');
  }
  if (!vacancy.vesselType) errors.push('Choose the vessel type of the vacancy.');

  return { profile: { resume, vacancy }, errors };
}
