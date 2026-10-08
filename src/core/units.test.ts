import { describe, expect, it } from 'vitest';
import { clamp, degToRad, metersToFeetInches, radToDeg, snap } from './units';

describe('Units & Math Utilities', () => {
  describe('snap', () => {
    it('snaps positive values correctly', () => {
      expect(snap(1.02, 0.05)).toBe(1.0);
      expect(snap(1.03, 0.05)).toBe(1.05);
      expect(snap(1.24, 0.05)).toBe(1.25);
      expect(snap(0, 0.05)).toBe(0);
    });

    it('works accurately for negative values', () => {
      expect(snap(-1.02, 0.05)).toBe(-1.0);
      expect(snap(-1.03, 0.05)).toBe(-1.05);
      expect(snap(-0.04, 0.05)).toBe(-0.05);
      expect(snap(-0.01, 0.05)).toBe(0);
      expect(Object.is(snap(-0.01, 0.05), 0)).toBe(true);
      expect(snap(-2.176, 0.1)).toBe(-2.2);
      expect(snap(-15.3, 15)).toBe(-15);
      expect(snap(-23.4, 15)).toBe(-30);
    });

    it('handles non-positive or invalid snap steps safely', () => {
      expect(snap(1.23, 0)).toBe(1.23);
      expect(snap(-1.23, -0.05)).toBe(-1.23);
    });
  });

  describe('degToRad and radToDeg', () => {
    it('converts degrees to radians accurately', () => {
      expect(degToRad(0)).toBe(0);
      expect(degToRad(90)).toBeCloseTo(Math.PI / 2);
      expect(degToRad(180)).toBeCloseTo(Math.PI);
      expect(degToRad(360)).toBeCloseTo(2 * Math.PI);
      expect(degToRad(-90)).toBeCloseTo(-Math.PI / 2);
    });

    it('converts radians to degrees accurately', () => {
      expect(radToDeg(0)).toBe(0);
      expect(radToDeg(Math.PI / 2)).toBeCloseTo(90);
      expect(radToDeg(Math.PI)).toBeCloseTo(180);
      expect(radToDeg(2 * Math.PI)).toBeCloseTo(360);
      expect(radToDeg(-Math.PI / 2)).toBeCloseTo(-90);
    });
  });

  describe('clamp', () => {
    it('restricts values within specified bounds', () => {
      expect(clamp(5, 0, 10)).toBe(5);
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(15, 0, 10)).toBe(10);
      expect(clamp(-3, -10, -5)).toBe(-5);
    });
  });

  describe('metersToFeetInches', () => {
    it('formats metric values into architectural feet and inches string', () => {
      expect(metersToFeetInches(0)).toBe('0\' 0"');
      // 1.0 m = 39.37 in = 3ft 3in
      expect(metersToFeetInches(1.0)).toBe('3\' 3"');
      // 2.7 m = 106.3 in = 8ft 10in
      expect(metersToFeetInches(2.7)).toBe('8\' 10"');
      // 4.0 m = 157.48 in = 13ft 1in
      expect(metersToFeetInches(4.0)).toBe('13\' 1"');
    });

    it('formats negative meters with a negative sign prefix', () => {
      expect(metersToFeetInches(-1.0)).toBe('-3\' 3"');
    });
  });
});
