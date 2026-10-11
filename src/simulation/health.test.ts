import { describe, expect, it } from 'vitest';
import { RoomSchema, type Room } from '../core/schema';
import { opening, rectRoom } from '../test/simulationFixtures';
import { createShowcaseHouse } from '../showcase/house';
import { simulateHouseNetwork } from './house/network';
import { CO2_GENERATION_M3H, OUTDOOR_CO2_PPM, co2Health, dailyPm25, effectiveOutdoorAch, estimateCo2, peakExposure, pm25Health, roomHazards, scheduledSources } from './health';

describe('health guidance', () => {
  it('PM2.5 uses the CPCB AQI bands and statements, and guideline multiples', () => {
    expect(pm25Health(25)).toMatchObject({ band: 'Good', statement: 'Minimal impact.' });
    expect(pm25Health(60).band).toBe('Satisfactory');
    expect(pm25Health(61).band).toBe('Moderate');
    expect(pm25Health(200)).toMatchObject({ band: 'Very poor', statement: 'Respiratory illness on prolonged exposure.' });
    expect(pm25Health(400).band).toBe('Severe');
    expect(pm25Health(150).timesWho).toBeCloseTo(10);
    expect(pm25Health(120).timesNaaqs).toBeCloseTo(2);
  });

  it('closed bedroom with two people asleep: CO₂ = outdoor + G·N / (infiltration × V)', () => {
    const room = RoomSchema.parse({ ...rectRoom(3.6, 3.2, 2.7), type: 'bedroom' });
    const co2 = estimateCo2(simulateHouseNetwork([room]))[0]!;
    const V = 3.6 * 3.2 * 2.7;
    const want = OUTDOOR_CO2_PPM + ((2 * CO2_GENERATION_M3H.sleeping) / (0.5 * V)) * 1e6;
    expect(co2).toBeCloseTo(want, 0);
    expect(co2Health(co2).label).toBe('Stale');
  });

  it('a cross-ventilated room stays close to outdoor CO₂; occupants can be set per room', () => {
    const aired = RoomSchema.parse({ ...rectRoom(3.6, 3.2, 2.7, { openings: [opening('n', 0, { offset: 1 }), opening('s', 2, { offset: 1 })] }), type: 'bedroom' });
    expect(estimateCo2(simulateHouseNetwork([aired]))[0]!).toBeLessThan(OUTDOOR_CO2_PPM + 100);
    const empty = RoomSchema.parse({ ...rectRoom(3.6, 3.2, 2.7), type: 'bedroom', occupants: 0 });
    expect(estimateCo2(simulateHouseNetwork([empty]))[0]!).toBeCloseTo(OUTDOOR_CO2_PPM, 0);
  });

  it("an empty room next to an occupied one gets some of its CO₂ through the open door", () => {
    const door = opening('door', 1, { type: 'door', offset: 1, width: 0.9, height: 2.1, sill: 0, role: 'outlet', openFraction: 1 });
    const bed = RoomSchema.parse({ ...rectRoom(4, 3, 2.5), id: 'bed', name: 'Bed', type: 'bedroom', openings: [door] });
    const bath = RoomSchema.parse({ ...rectRoom(3, 3, 2.5), id: 'bath', name: 'Bath', type: 'bathroom', outline: [[4.15, 0], [7.15, 0], [7.15, 3], [4.15, 3]] });
    const [cBed, cBath] = estimateCo2(simulateHouseNetwork([bed, bath] as Room[]));
    expect(cBath!).toBeGreaterThan(OUTDOOR_CO2_PPM + 100);
    expect(cBath!).toBeLessThan(cBed!);
  });

  it('24-hour average: a 30-minute source counts for 30 minutes, an unscheduled one all day', () => {
    const src = (extra = {}) => ({ id: 's', assetId: 'pm25-stove-frying', name: 'Frying', position: [2, 0, 1.5], size: [0.36, 0.1, 0.36], elevation: 0.9, role: 'none', ...extra });
    const sim = (rooms: readonly Room[], durationS: number) => simulateHouseNetwork(rooms, {}, { durationS, dtS: 300 });
    const allDay = dailyPm25([RoomSchema.parse({ ...rectRoom(4, 3, 2.5), objects: [src()] })], sim);
    const halfHour = dailyPm25([RoomSchema.parse({ ...rectRoom(4, 3, 2.5), objects: [src({ sourceSchedule: [{ startMin: 600, durationMin: 30 }] })] })], sim);
    expect(allDay.alwaysOn).toEqual(['Frying (Test room)']);
    expect(halfHour.alwaysOn).toEqual([]);
    expect(halfHour.meanUgM3[0]!).toBeLessThan(allDay.meanUgM3[0]! / 5);
    // A 30-minute burst in a sealed room still leaves a lasting excess: ~1.7 mg/min × 30 min spread over the day's exposure
    expect(halfHour.meanUgM3[0]!).toBeGreaterThan(pm25Health(0).ugM3);
  });

  it('hazards: leaks-only rooms, carbon monoxide from heaters, gas fumes without a hood', () => {
    const heater = { id: 'h', assetId: 'pm25-heater', name: 'Heater', position: [1, 0, 1] as [number, number, number], size: [0.4, 0.5, 0.3] as [number, number, number], role: 'none' as const };
    const stove = { ...heater, id: 'st', assetId: 'pm25-stove-frying', name: 'Frying' };
    const closed = RoomSchema.parse({ ...rectRoom(3, 3, 2.7), objects: [heater] });
    const titles = (r: Room, ach: number, exhaust = false) => roomHazards(r, ach, 0.5, exhaust).map((h) => h.title);
    // Closed room (only the 0.5 /h leakage): CO first, then poor ventilation
    expect(titles(closed, 0.5)).toEqual(['Carbon monoxide: can be fatal', 'Poorly ventilated: fresh air only through leaks']);
    expect(roomHazards(closed, 0.5, 0.5, false)[0]!.level).toBe(3);
    // Window open (5 /h): CO is still flagged (unvented heater), ventilation is fine
    expect(titles(closed, 5)).toEqual(['Carbon monoxide: can be fatal']);
    // Switched-off heater: no CO warning
    expect(titles(RoomSchema.parse({ ...closed, objects: [{ ...heater, enabled: false }] }), 5)).toEqual([]);
    // Gas stove in a shut kitchen: fumes, unless a hood or exhaust runs
    const kitchen = RoomSchema.parse({ ...rectRoom(3, 3, 2.7), objects: [stove] });
    expect(titles(kitchen, 0.5)).toContain('Gas cooking fumes build up');
    expect(titles(kitchen, 0.5, true)).not.toContain('Gas cooking fumes build up');
  });

  it('flags the PM2.5 while sources run when it is much worse than the day average', () => {
    // Kitchen: frying for half an hour a day; ~500 while it runs, ~60 over the day
    expect(peakExposure(60, 500)!.band).toBe('Severe');
    // Same band, or barely higher: nothing extra to say
    expect(peakExposure(70, 85)).toBeNull();
    expect(peakExposure(58, 62)).toBeNull();
    // Sources on a schedule are listed; unscheduled or switched-off ones are not
    const src = (extra = {}) => ({ id: 's', assetId: 'pm25-stove-frying', name: 'Frying', position: [1, 0, 1], size: [0.36, 0.1, 0.36], role: 'none', ...extra });
    const k = (o: object) => RoomSchema.parse({ ...rectRoom(3, 3, 2.7), id: 'k', name: 'Kitchen', objects: [o] });
    expect(scheduledSources([k(src({ sourceSchedule: [{ startMin: 0, durationMin: 30 }] }))])).toEqual([{ activity: 'frying', roomId: 'k', roomName: 'Kitchen' }]);
    expect(scheduledSources([k(src())])).toEqual([]);
  });

  it('a room fed outdoor air through other rooms is not "poorly ventilated"', () => {
    // Showcase flat: the living room's own openings all flow out; it is flushed from the bedrooms
    const net = simulateHouseNetwork(createShowcaseHouse());
    const living = net.zones.find((z) => z.name === 'Living Room')!;
    expect(living.achOutdoor).toBeLessThan(1);
    const ach = effectiveOutdoorAch(living.achOutdoor, living.ageMinutes);
    expect(ach).toBeGreaterThan(5);
    expect(roomHazards(RoomSchema.parse(rectRoom(3, 3, 2.7)), ach, 0.5, false)).toEqual([]);
    // A sealed room's air is ~2 h old at 0.5 /h: still flagged
    expect(effectiveOutdoorAch(0.5, 120)).toBeCloseTo(0.5);
  });
});
