import { ESTIMATED_LOTTERY_RATE_LABEL, type RawLotteryData } from './lottery-data.model';
import {
  buildLotteryRateRecords,
  buildSchoolLotteryRates,
  normalizeSearchText,
  searchSchoolLotteryRates,
} from './lottery-data.utils';

describe('lottery data utilities', () => {
  const sampleData = {
    臺北市蘭州非營利幼兒園: {
      '5歲': { 正取: 1, 備取: 3 },
      '4歲': { 正取: 9, 備取: 2 },
      '3歲': { 正取: 24, 備取: 22 },
      '2歲專班': { 正取: 16, 備取: 39 },
    },
  } satisfies RawLotteryData;

  it('derives estimated lottery rates and keeps sensible age sorting', () => {
    const [school] = buildSchoolLotteryRates(sampleData);

    expect(school?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(school?.ageGroups.map((group) => group.ageGroup)).toEqual([
      '5歲',
      '4歲',
      '3歲',
      '2歲專班',
    ]);

    const ratesByAge = new Map(school?.ageGroups.map((group) => [group.ageGroup, group]));

    expect(ratesByAge.get('5歲')?.estimatedLotteryRatePercent).toBeCloseTo(25);
    expect(ratesByAge.get('4歲')?.estimatedLotteryRatePercent).toBeCloseTo(81.818, 3);
    expect(ratesByAge.get('3歲')?.estimatedLotteryRatePercent).toBeCloseTo(52.174, 3);
    expect(ratesByAge.get('2歲專班')?.estimatedLotteryRatePercent).toBeCloseTo(29.091, 3);
    expect(ratesByAge.get('5歲')?.estimatedLotteryRateLabel).toBe(
      ESTIMATED_LOTTERY_RATE_LABEL,
    );
  });

  it('normalizes 臺/台 variants and punctuation for search', () => {
    expect(normalizeSearchText(' 臺 北・蘭州 ')).toBe('台北蘭州');

    const schools = buildSchoolLotteryRates(sampleData);
    const [match] = searchSchoolLotteryRates(schools, '台北蘭州');

    expect(match?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(match?.matchScore).toBeGreaterThan(0);
  });

  it('returns no matches for unrelated keywords', () => {
    const schools = buildSchoolLotteryRates(sampleData);

    expect(searchSchoolLotteryRates(schools, '不存在')).toEqual([]);
  });

  it('returns multiple fuzzy matches without unrelated schools', () => {
    const schools = buildSchoolLotteryRates({
      臺北市蘭州非營利幼兒園: {
        '3歲': { 正取: 1, 備取: 1 },
      },
      台北市蘭雅國民小學附設幼兒園: {
        '3歲': { 正取: 2, 備取: 2 },
      },
      新北市蘆洲幼兒園: {
        '3歲': { 正取: 3, 備取: 3 },
      },
    } satisfies RawLotteryData);

    const matches = searchSchoolLotteryRates(schools, '台北蘭');

    expect(matches.map((match) => match.schoolName)).toEqual([
      '臺北市蘭州非營利幼兒園',
      '台北市蘭雅國民小學附設幼兒園',
    ]);
    expect(matches[0]?.matchScore).toBeGreaterThanOrEqual(matches[1]?.matchScore ?? 0);
  });

  it('handles zero denominators and invalid counts without producing NaN rates', () => {
    const records = buildLotteryRateRecords({
      測試幼兒園: {
        '5歲': { 正取: 0, 備取: 0 },
        '4歲': { 正取: 'many', 備取: 2 },
        '3歲': {},
      },
    });

    const recordsByAge = new Map(records.map((record) => [record.ageGroup, record]));

    expect(recordsByAge.get('5歲')?.estimatedLotteryRate).toBeNull();
    expect(recordsByAge.get('5歲')?.dataQualityIssues.map((issue) => issue.code)).toContain(
      'zero-denominator',
    );
    expect(recordsByAge.get('4歲')?.acceptedCount).toBe(0);
    expect(recordsByAge.get('4歲')?.waitlistedCount).toBe(2);
    expect(recordsByAge.get('4歲')?.estimatedLotteryRate).toBe(0);
    expect(recordsByAge.get('4歲')?.dataQualityIssues.map((issue) => issue.code)).toContain(
      'non-numeric-count',
    );
    expect(recordsByAge.get('3歲')?.dataQualityIssues.map((issue) => issue.code)).toContain(
      'missing-count',
    );
  });
});
