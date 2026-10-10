import type { SiteExposure } from '../core/schema';

/**
 * Physical defaults for the indoor air-quality simulation, in SI units unless the name says otherwise.
 * Every value names its source; `TODO verify` marks approximations that should be checked against
 * the cited reference before results are presented as anything more than indicative.
 */

// ---------------------------------------------------------------------------
// Air and gravity
// ---------------------------------------------------------------------------

/** Air density at ~20 °C, sea level (kg/m³). ISO 2533 standard atmosphere gives 1.225 at 15 °C. */
export const AIR_DENSITY = 1.2;

/** Standard gravity (m/s²). CGPM 1901 / ISO 80000-3. */
export const GRAVITY = 9.80665;

/** Offset from °C to K. */
export const KELVIN_OFFSET = 273.15;

// ---------------------------------------------------------------------------
// Natural ventilation
// ---------------------------------------------------------------------------

/**
 * Discharge coefficient of a sharp-edged opening. BS 5925:1991 and CIBSE AM10 use 0.61; 0.6 is the
 * usual rounded value. Real windows (hinged, partly open, with insect screens) can be much lower.
 * TODO verify per opening type (CIBSE AM10 §4.2 gives lower Cd for top/bottom-hung windows).
 */
export const DISCHARGE_COEFFICIENT = 0.6;

// ---------------------------------------------------------------------------
// Site exposure: wind speed reduction and pressure coefficients
// ---------------------------------------------------------------------------

/** Exposure assumed when a design does not set one (most Airforce users are in dense Indian cities). */
export const DEFAULT_SITE_EXPOSURE: SiteExposure = 'urbanDense';

/**
 * Local wind at height z from the reported (met-station, 10 m, open country) wind:
 *   U_z = U_met · K · z^a
 * Terrain coefficients from BS 5925:1991 Table 8 (reproduced in CIBSE AM10 / Guide A):
 *   open flat country K 0.68 a 0.17 · country with scattered windbreaks 0.52 / 0.20 ·
 *   urban 0.35 / 0.25 · city 0.21 / 0.33.
 * Mapping: open → open flat country, suburban → urban, urbanDense → city. TODO verify table values
 * and the suburban mapping (it could equally be "scattered windbreaks").
 */
export const TERRAIN_WIND_COEFFICIENTS: Record<SiteExposure, { K: number; a: number }> = {
  open: { K: 0.68, a: 0.17 },
  suburban: { K: 0.35, a: 0.25 },
  urbanDense: { K: 0.21, a: 0.33 },
};

/**
 * Height (m) at which the local wind is evaluated. Per-building height is not modelled yet; 10 m is
 * roughly the eaves of a 3-storey block and makes the 'open' factor ≈ 1. TODO make per project.
 */
export const WIND_REFERENCE_HEIGHT_M = 10;

/**
 * Surface-averaged wind pressure coefficients for a low-rise building (≤ 3 storeys, plan 1:1) at
 * wind incidence 0°, 45°, 90°, 135°, 180° relative to the wall's outward normal, by shielding class.
 * After the AIVC tables: Liddament, "Air Infiltration Calculation Techniques – An Applications
 * Guide" (AIVC, 1986) and Orme, Liddament & Wilson, AIVC Technical Note 44 (1998):
 *   exposed        +0.70 +0.35 −0.50 −0.40 −0.20
 *   semi-sheltered +0.40 +0.10 −0.30 −0.35 −0.20  (obstructions ≈ half the building height)
 *   sheltered      +0.20 +0.05 −0.25 −0.30 −0.25  (obstructions ≈ the building height)
 * Mapping: open → exposed, suburban → semi-sheltered, urbanDense → sheltered.
 * TODO verify each value against TN44 (quoted from memory of the table, not re-checked).
 */
export const CP_INCIDENCE_DEG: readonly number[] = [0, 45, 90, 135, 180];
export const CP_BY_EXPOSURE: Record<SiteExposure, readonly number[]> = {
  open: [0.7, 0.35, -0.5, -0.4, -0.2],
  suburban: [0.4, 0.1, -0.3, -0.35, -0.2],
  urbanDense: [0.2, 0.05, -0.25, -0.3, -0.25],
};

/**
 * Single-sided wind-driven ventilation: Q ≈ 0.025 · A · U.
 * BS 5925:1991 and CIBSE AM10 (2005), "wind only, single opening". TODO verify clause numbers.
 */
export const SINGLE_SIDED_WIND_COEFFICIENT = 0.025;

/**
 * Single large opening stack flow: Q = Cd · (A/3) · sqrt(g · h · |ΔT| / T_mean).
 * BS 5925:1991 eq. for a single opening with temperature difference; CIBSE AM10.
 */
export const SINGLE_OPENING_STACK_AREA_FACTOR = 1 / 3;

/**
 * Minimum vertical distance between the centres of low and high openings (m) before the
 * two-opening stack formula is used instead of summing single-opening exchanges. Below this, the
 * openings are effectively at one height. Engineering choice, not from a standard. TODO verify.
 */
export const STACK_TWO_OPENING_MIN_HEIGHT_DIFF = 0.5;

/**
 * Two outward normals are treated as the same facade (single-sided ventilation) when their dot
 * product exceeds this (≈ 8°). Engineering choice.
 */
export const SAME_FACADE_NORMAL_DOT = 0.99;

// ---------------------------------------------------------------------------
// PM2.5 fate indoors
// ---------------------------------------------------------------------------

/**
 * First-order PM2.5 deposition loss rate (1/s). 0.2 /h is mid-range: Riley et al., Environ. Sci.
 * Technol. 36 (2002) 200–207 model ~0.1–0.5 /h for the 0.1–2.5 µm accumulation mode; the PTEAM study
 * (Özkaynak et al. 1996) fitted 0.39 /h for PM2.5. Depends strongly on size distribution and
 * furnishing. TODO verify.
 */
export const PM25_DEPOSITION_RATE_PER_S = 0.2 / 3600;

/**
 * Penetration factor P for air entering through open windows/doors. Large openings do not filter
 * particles, so P ≈ 1 (Chen & Zhao, Atmos. Environ. 45 (2011) 275–288, review of I/O ratios).
 */
export const OPEN_WINDOW_PENETRATION = 1.0;

/**
 * Penetration factor for air drawn through cracks/envelope leaks (makeup air for exhaust fans and
 * background infiltration). Chen & Zhao (2011) report ~0.6–1.0 for PM2.5. TODO verify.
 */
export const INFILTRATION_PENETRATION = 0.8;

/**
 * Background infiltration through the closed envelope (1/h), applied in every run unless the caller
 * overrides it (pass 0 for purely mechanical/natural results). 0.5 /h is a commonly quoted value for
 * fairly leaky residential construction; ASHRAE Fundamentals (2021) ch. 16 gives ~0.2–1 /h.
 * Not exposure-adjusted: the shielding-dependent infiltration models (e.g. LBL / AIM-2) need a
 * measured leakage area, which designs do not have, so scaling a nominal ACH by shielding would be
 * false precision. TODO verify for Indian housing stock.
 */
export const DEFAULT_INFILTRATION_ACH = 0.5;

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

/**
 * Default volumetric rate per device kind (m³/h), used when an object has neither an explicit
 * `cadrM3h` / `exhaustFlowM3h` nor `defaultAirflow`.
 * - purifier: PM2.5 CADR of a mid-size HEPA unit, ~200–400 m³/h (AHAM AC-1 ratings). When only the
 *   fan airflow (`defaultAirflow`) is known we use it as CADR, i.e. ~100% single-pass efficiency,
 *   ignoring bypass and short-circuiting. TODO verify.
 * - exhaustFan: 150–200 mm domestic wall fan, ~150–300 m³/h. TODO verify.
 * - rangeHood: domestic kitchen hood, ~300–700 m³/h. TODO verify.
 * - ceilingFan: 1200 mm fan, BIS IS 374 minimum air delivery ≈ 210 m³/min ≈ 12 600 m³/h. TODO verify.
 * - pedestalFan: 400 mm fan, ~60–90 m³/min. TODO verify.
 * - ac: 1.5 TR split indoor unit, ~600 CFM ≈ 1000 m³/h. TODO verify.
 * Mixing devices (fans, AC) only matter to the voxel solver; they do not change ACH.
 */
export const DEFAULT_DEVICE_FLOW_M3H = {
  purifier: 250,
  exhaustFan: 250,
  rangeHood: 400,
  ceilingFan: 12600,
  pedestalFan: 4500,
  ac: 1000,
} as const;

export const DEFAULT_PURIFIER_CADR_M3H = DEFAULT_DEVICE_FLOW_M3H.purifier;

/**
 * Default discharge (jet) velocity per device kind (m/s) for the voxel solver's momentum source.
 * Exhaust devices are flow boundaries (velocity = flow / face area), so they have none.
 * - ceilingFan ~2–3 m/s downdraft under the blades at high speed (ASHRAE 55 elevated-air-speed
 *   literature). - pedestalFan ~3–4 m/s near the guard. - ac: split units supply ~2.5–4 m/s.
 * - purifier outlet grilles ~1–2 m/s. All approximate. TODO verify.
 */
export const DEFAULT_DISCHARGE_VELOCITY_MS = {
  purifier: 1.5,
  exhaustFan: null,
  rangeHood: null,
  ceilingFan: 2.5,
  pedestalFan: 3.0,
  ac: 3.0,
} as const;

// ---------------------------------------------------------------------------
// PM2.5 emission rates (µg/min while active). Measured rates vary by an order of magnitude with
// fuel, food, ventilation and method; these are representative mid-range values. TODO verify each.
// ---------------------------------------------------------------------------

export interface Pm25SourcePreset {
  label: string;
  /** Emission rate while active (µg/min) */
  rateUgMin: number;
  /** Default height above the floor where the source emits (m) */
  heightM: number;
  /** Catalog asset of the placeable marker */
  assetId: string;
  /** Where the number comes from; `approximate` = no direct measurement, an estimate */
  reference: string;
  approximate: boolean;
}

/**
 * Placeable PM2.5 source presets. Heights: pan on a counter-top stove ≈ 1.0 m; incense, diya and
 * candle on a shelf or table ≈ 0.8–0.9 m; mosquito coil on the floor ≈ 0.1 m; a seated smoker's
 * cigarette ≈ 1.0 m; sweeping stirs up dust near the floor ≈ 0.3 m; a heater ≈ 0.5 m.
 */
export const PM25_SOURCE_PRESETS = {
  /**
   * He, Morawska, Hitchins & Gilbert, Atmos. Environ. 38 (2004) 3405–3415, and Wallace, Emmerich &
   * Howard-Reed, Environ. Sci. Technol. 38 (2004) 2304–2311: frying/sautéing on gas ≈ 1–2 mg/min.
   */
  'gas-stove-frying': { label: 'Gas stove: frying', rateUgMin: 1700, heightM: 1.0, assetId: 'pm25-stove-frying', reference: 'He et al. 2004; Wallace et al. 2004 (≈1–2 mg/min)', approximate: false },
  /** Boiling/steaming on gas: ≈ 0.1–0.5 mg/min (He et al. 2004; Olson & Burke, ES&T 40 (2006) 163). */
  'gas-stove-boiling': { label: 'Gas stove: boiling', rateUgMin: 300, heightM: 1.0, assetId: 'pm25-stove-boiling', reference: 'He et al. 2004; Olson & Burke 2006 (≈0.1–0.5 mg/min)', approximate: false },
  /**
   * Roti on a dry tawa over LPG: no direct emission-rate measurement found. Dry griddle heating
   * with flour char sits between boiling and frying; estimate. TODO verify.
   */
  'tawa-roti': { label: 'Tawa / roti', rateUgMin: 600, heightM: 1.0, assetId: 'pm25-tawa', reference: 'Estimate between boiling and frying', approximate: true },
  /**
   * Jetter, Guo, McBrian & Flynn, Sci. Total Environ. 295 (2002) 51–67: 23 incense types emitted
   * 7–202 mg/h of PM2.5 (≈ 0.1–3.4 mg/min); a lower-middle value for one agarbatti stick.
   */
  incense: { label: 'Incense (agarbatti)', rateUgMin: 400, heightM: 0.9, assetId: 'pm25-incense', reference: 'Jetter et al. 2002 (7–202 mg/h)', approximate: false },
  /**
   * Liu, Zhang, Hashim et al., Environ. Health Perspect. 111 (2003) 1454–1460: one coil releases
   * as much PM2.5 as 75–137 cigarettes. At ~10 mg per cigarette over a ~7–8 h burn that is
   * ≈ 1.5–3 mg/min; a lower value is used because coil brands vary widely. TODO verify.
   */
  'mosquito-coil': { label: 'Mosquito coil', rateUgMin: 1500, heightM: 0.1, assetId: 'pm25-mosquito-coil', reference: 'Liu et al. 2003 (75–137 cigarettes per coil)', approximate: true },
  /**
   * Paraffin candle ≈ 0.01–0.1 mg/min, strongly dependent on sooting (e.g. Pagels et al., Indoor
   * Air 19 (2009) 383); an oil/ghee diya flame is assumed similar or sootier. TODO verify.
   */
  'candle-diya': { label: 'Candle / diya', rateUgMin: 80, heightM: 0.8, assetId: 'pm25-candle', reference: 'Pagels et al. 2009 (candles); diya assumed similar', approximate: true },
  /**
   * Klepeis, Apte, Gundel, Sextro & Nazaroff, Aerosol Sci. Technol. 37 (2003) 780–790: ≈ 11–14 mg
   * of ETS PM2.5 per cigarette over ~8–10 min ≈ 1.4 mg/min.
   */
  cigarette: { label: 'Cigarette', rateUgMin: 1400, heightM: 1.0, assetId: 'pm25-cigarette', reference: 'Klepeis et al. 2003 (≈1.4 mg/min)', approximate: false },
  /**
   * Ferro, Kopperud & Hildemann, Environ. Sci. Technol. 38 (2004) 1759–1764: resuspension by
   * dusting, vacuuming and walking ≈ 0.03–0.4 mg/min of PM2.5. Dry sweeping (jhadu) is assumed to
   * sit near the top of that range. TODO verify.
   */
  'sweeping-dusting': { label: 'Sweeping / dusting', rateUgMin: 300, heightM: 0.3, assetId: 'pm25-sweeping', reference: 'Ferro et al. 2004 (0.03–0.4 mg/min)', approximate: true },
  /**
   * Unvented kerosene heaters emit little PM2.5 when well tuned (Traynor et al., ES&T 17 (1983)
   * 369) but much more when mistuned; coal angithis are far dirtier. One mid value for both is a
   * coarse estimate. TODO verify.
   */
  'kerosene-coal-heater': { label: 'Kerosene / coal heater', rateUgMin: 1000, heightM: 0.5, assetId: 'pm25-heater', reference: 'Traynor et al. 1983 (kerosene); coal estimate', approximate: true },
} as const satisfies Record<string, Pm25SourcePreset>;

export type Pm25SourcePresetId = keyof typeof PM25_SOURCE_PRESETS;

/** Room-level source kinds (Simulation tab, no position) and their rates, from the presets above. */
export const PM25_EMISSION_RATES_UG_PER_MIN = {
  'cooking-frying': PM25_SOURCE_PRESETS['gas-stove-frying'].rateUgMin,
  'cooking-boiling': PM25_SOURCE_PRESETS['gas-stove-boiling'].rateUgMin,
  cigarette: PM25_SOURCE_PRESETS.cigarette.rateUgMin,
  incense: PM25_SOURCE_PRESETS.incense.rateUgMin,
  'mosquito-coil': PM25_SOURCE_PRESETS['mosquito-coil'].rateUgMin,
  candle: PM25_SOURCE_PRESETS['candle-diya'].rateUgMin,
} as const;

/**
 * Outdoor PM2.5 scenario chips (µg/m³). Illustrative round numbers for typical Delhi conditions,
 * not measurements: a moderate day; winter smog (CPCB daily means of 200–300 are common in
 * Nov–Jan); the night after Diwali (hourly values above 400 are regularly reported); a
 * stubble-burning episode. TODO verify against CPCB data for the use case.
 */
export const OUTDOOR_PM25_SCENARIOS = [
  { id: 'typical', label: 'Typical day', valueUgM3: 60 },
  { id: 'winter-smog', label: 'Delhi winter smog', valueUgM3: 250 },
  { id: 'post-diwali', label: 'Post-Diwali night', valueUgM3: 400 },
  { id: 'stubble', label: 'Stubble-burning episode', valueUgM3: 300 },
] as const;

export type Pm25SourceKind = keyof typeof PM25_EMISSION_RATES_UG_PER_MIN;

// ---------------------------------------------------------------------------
// Thresholds (µg/m³, 24-hour mean guidelines; comparing them to instantaneous C is indicative only)
// ---------------------------------------------------------------------------

/** WHO Global Air Quality Guidelines (2021): PM2.5 24-hour AQG level 15 µg/m³. */
export const WHO_2021_PM25_24H = 15;

/** India National Ambient Air Quality Standards (CPCB, 2009): PM2.5 24-hour 60 µg/m³. */
export const INDIA_NAAQS_PM25_24H = 60;

export interface Pm25Threshold {
  id: string;
  label: string;
  valueUgM3: number;
}

export const PM25_THRESHOLDS: readonly Pm25Threshold[] = [
  { id: 'who-2021-24h', label: 'WHO 2021 24h guideline', valueUgM3: WHO_2021_PM25_24H },
  { id: 'india-naaqs-24h', label: 'India NAAQS 24h', valueUgM3: INDIA_NAAQS_PM25_24H },
];

// ---------------------------------------------------------------------------
// Defaults for runs and display
// ---------------------------------------------------------------------------

/** Outdoor PM2.5 (µg/m³) used when the design has no outdoor value. Arbitrary moderate urban value. */
export const DEFAULT_OUTDOOR_PM25 = 35;

/** Default simulated duration (s) and output step (s). */
export const DEFAULT_DURATION_S = 4 * 3600;
export const DEFAULT_TIME_STEP_S = 60;

/**
 * Breathing-zone height band (m): seated (~1.1 m) to standing (~1.7 m) adult nose height.
 * Common convention in ventilation-effectiveness studies (e.g. ASHRAE 62.1 breathing zone is
 * 0.075–1.8 m; 1.1–1.7 m narrows it to occupied head heights). TODO verify for the use case.
 */
export const BREATHING_ZONE_HEIGHT_M: readonly [number, number] = [1.1, 1.7];

export const SECONDS_PER_HOUR = 3600;

// ---------------------------------------------------------------------------
// Voxel (CFD-lite) solver
// ---------------------------------------------------------------------------

/** Grid spacing (m) for the two resolutions. */
export const VOXEL_DX_LIVE = 0.2;
export const VOXEL_DX_FULL = 0.1;

/**
 * Effective (eddy) kinematic viscosity (m²/s). The solver has no turbulence model; a constant eddy
 * viscosity stands in for room-scale turbulent mixing. Indoor turbulent diffusivities measured with
 * tracer gases are ~1e-3–1e-2 m²/s in still rooms and higher with fans (e.g. Cheng et al., Environ.
 * Sci. Technol. 45 (2011) 4016, "proximity effect"). 0.01 is a deliberately mixed choice. TODO verify.
 */
export const EDDY_VISCOSITY = 0.01;

/** Eddy diffusivity for PM2.5 and age of air (m²/s); turbulent Schmidt number ≈ 1. TODO verify. */
export const EDDY_DIFFUSIVITY = 0.01;

/**
 * Velocity damping rate inside porous objects (1/s): face velocities are multiplied by
 * (1 − α) each step with α = 1 − exp(−rate·dt), so the damping does not depend on dt. 5 /s makes a
 * bookshelf or chair a strong but leaky obstacle. Fudge factor, not from a source. TODO calibrate.
 */
export const POROUS_DAMPING_RATE = 5;

/** Time constant (s) for relaxing face velocities toward a device's discharge velocity. Fudge. */
export const JET_RELAXATION_TIME_S = 0.25;

/** Depth (m) of the jet region in front of / below a device outlet. Fudge. */
export const JET_DEPTH_M = 0.3;

/**
 * Fraction of the fan's diameter that the jet covers (blade disc minus hub). A ceiling fan's jet
 * radius is ~0.45 of its 1.2 m span. Fudge. TODO verify against fan curves.
 */
export const FAN_JET_DIAMETER_FRACTION = 0.9;

/**
 * Share of PM2.5 removed by an AC's own filter per pass. Split AC mesh filters barely capture
 * PM2.5, so 0 by default. TODO: allow per-device override.
 */
export const AC_FILTRATION_EFFICIENCY = 0;

/**
 * Single-pass PM2.5 capture of a portable purifier's filter. The voxel solver moves
 * Q_fan = CADR / efficiency through the unit (intake → outlet), returning (1 − efficiency)·C_intake,
 * so the removal is exactly CADR × local intake concentration. True HEPA is ≥ 0.97 at the most
 * penetrating size; 0.95 allows for bypass. TODO verify per product.
 */
export const PURIFIER_SINGLE_PASS_EFFICIENCY = 0.95;

/** CFL number for the semi-Lagrangian velocity step (SL is stable above 1; this bounds accuracy). */
export const VOXEL_CFL = 2;

/** Stop the velocity solve when the max face change per step / max speed drops below this… */
export const VOXEL_VELOCITY_TOL = 2e-3;
/** …and the normalised divergence residual drops below this. */
export const VOXEL_DIVERGENCE_TOL = 1e-4;
/** Hard cap on velocity steps (live / full). */
export const VOXEL_MAX_VELOCITY_STEPS = 600;
/** Relative tolerance of the pressure CG solve. */
export const VOXEL_PRESSURE_TOL = 1e-6;
/** Relative tolerance of the scalar BiCGSTAB solves. */
export const VOXEL_SCALAR_TOL = 1e-8;

/** Default transient snapshot times (s). */
export const VOXEL_SNAPSHOT_TIMES_S: readonly number[] = [0, 5, 15, 30, 60, 120, 240].map((m) => m * 60);
/**
 * Backward-Euler step for the transient PM2.5 run: this fraction of the box-model time constant,
 * clamped to [VOXEL_MIN_SCALAR_DT_S, VOXEL_MAX_SCALAR_DT_S]. Fast-flushing rooms get short steps
 * (accuracy), slow closed rooms long ones (speed); backward Euler is stable at any step.
 */
export const VOXEL_SCALAR_DT_FRACTION = 0.5;
export const VOXEL_MIN_SCALAR_DT_S = 30;
export const VOXEL_MAX_SCALAR_DT_S = 300;

/** The velocity solve runs at least one flow-through time, capped at this (s). */
export const VOXEL_MAX_MIN_FLOW_TIME_S = 60;

/**
 * Default hotspot thresholds, relative to the volume-mean of the field: cells above
 * HOTSPOT_RELATIVE × mean form clusters. Callers can pass absolute µg/m³ / minute thresholds.
 */
export const HOTSPOT_RELATIVE = 1.2;
/** Smallest cluster reported (m³). */
export const HOTSPOT_MIN_VOLUME_M3 = 0.02;

// ---------------------------------------------------------------------------
// Whole-house (multi-zone) model
// ---------------------------------------------------------------------------

/**
 * Effective gap under an interior door (m), applied across the door width as an always-open
 * orifice so closed rooms stay weakly connected. ~1 cm is a common undercut; ventilation guidance
 * (e.g. UK Approved Document F) asks for ~7600 mm² (≈ 1 cm under a 76 cm door). TODO verify.
 */
export const DOOR_UNDERCUT_HEIGHT_M = 0.01;

/**
 * Envelope leakage per m² of floor (m²), modelled as one small orifice to outdoors per room so the
 * pressure network is always solvable (e.g. a room with an exhaust fan and everything shut).
 * 1 cm²/m² is of the order of ASHRAE effective leakage areas for average construction. Its flow only
 * balances pressures; the PM2.5 exchange through the envelope is the separate infiltration ACH.
 * TODO verify.
 */
export const ENVELOPE_LEAK_AREA_PER_M2_FLOOR = 1e-4;

/** Vertical slices per exterior opening in the network model, so stack flow can go both ways. */
export const NETWORK_OPENING_SEGMENTS = 4;

/** Below this pressure difference (Pa) orifice flow is linearised (keeps Newton's Jacobian finite). */
export const NETWORK_LINEAR_DP_PA = 1e-4;

/** Outdoor margin (m) around the house in the voxel grid. */
export const HOUSE_MARGIN_M = 1.5;

/** Specific gas constant of dry air (J/(kg·K)); density ρ = p / (R·T). */
export const AIR_GAS_CONSTANT = 287.05;

/** Normalised age of air (local age ÷ room's nominal time constant) above which air counts as stagnant. */
export const STAGNANT_NORMALISED_AGE = 1.5;

/**
 * The view highlights only clearly stale air: older than twice the house's flush time (and in the
 * worst ~20 % of the house, at most three zones; see viz/stagnation.ts). Display only; the solver's
 * stagnant analysis uses STAGNANT_NORMALISED_AGE.
 */
export const STALE_HIGHLIGHT_NORMALISED_AGE = 2;

// ---------------------------------------------------------------------------
// What-if scenarios and ranked actions (src/simulation/scenarios)

/**
 * Default occupancy weight per room type: roughly the share of a day people spend there, so the
 * house PM2.5 metric counts the air people actually breathe. Bedrooms (≈ 8–9 h of sleep) and the
 * living room (most waking hours at home) weigh most; kitchens (cooking time), bathrooms and
 * storage little. Editable per room (Room tab → "Occupancy weight", stored as room.occupancyWeight).
 */
export const OCCUPANCY_WEIGHTS = {
  bedroom: 1,
  living: 0.8,
  dining: 0.5,
  basic: 0.5,
  kitchen: 0.3,
  bathroom: 0.1,
} as const;

/** A room counts as occupied (purifier targets, "time for occupied rooms to fall below 60") at this weight or above. */
export const OCCUPIED_WEIGHT_MIN = 0.5;

/** Ranked actions changing the objective by less than both of these are dropped as near-zero. */
export const ACTION_MIN_DELTA_UGM3 = 0.5;
export const ACTION_MIN_DELTA_FRACTION = 0.01;

/** "Ajar" window opening for generated window actions. */
export const WINDOW_AJAR_FRACTION = 0.2;

/** Voxel results kept in memory (keyed by design + inputs). */
export const VOXEL_CACHE_SIZE = 8;

/**
 * Version of the voxel solver's numerics. Precomputed results (public/showcase) record it in their
 * hash; bump it whenever a change to src/simulation/voxel alters results, then run
 * `npm run showcase:build`.
 */
export const VOXEL_SOLVER_VERSION = 'voxel-2026.10.1';
