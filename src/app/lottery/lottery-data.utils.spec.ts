import { ESTIMATED_LOTTERY_RATE_LABEL, type RawLotteryData } from './lottery-data.model';
import {
  buildLotteryRateRecords,
  buildSchoolLotteryRates,
  normalizeSearchText,
  searchSchoolLotteryRates,
} from './lottery-data.utils';

describe('抽籤資料工具', () => {
  const sampleData = {
    臺北市蘭州非營利幼兒園: {
      搜尋關鍵字: ['大同區', '臺北市大同區'],
      '5歲': { 正取: 1, 備取: 3 },
      '4歲': { 正取: 9, 備取: 2 },
      '3歲': { 正取: 24, 備取: 22 },
      '2歲專班': { 正取: 16, 備取: 39 },
    },
  } satisfies RawLotteryData;

  it('應推導估算中籤率並維持合理班齡排序', () => {
    const [school] = buildSchoolLotteryRates(sampleData);

    expect(school?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(school?.ageGroups.map((group) => group.ageGroup)).toEqual([
      '5歲',
      '4歲',
      '3歲',
      '2歲專班',
    ]);
    expect(school?.searchKeywords).toEqual(['大同區', '臺北市大同區']);
    expect(school?.districtNames).toEqual(['大同區']);

    const ratesByAge = new Map(school?.ageGroups.map((group) => [group.ageGroup, group]));

    expect(ratesByAge.get('5歲')?.estimatedLotteryRatePercent).toBeCloseTo(25);
    expect(ratesByAge.get('5歲')?.generalWaitlistedCount).toBe(3);
    expect(ratesByAge.get('4歲')?.estimatedLotteryRatePercent).toBeCloseTo(81.818, 3);
    expect(ratesByAge.get('3歲')?.estimatedLotteryRatePercent).toBeCloseTo(52.174, 3);
    expect(ratesByAge.get('2歲專班')?.estimatedLotteryRatePercent).toBeCloseTo(29.091, 3);
    expect(ratesByAge.get('5歲')?.estimatedLotteryRateLabel).toBe(ESTIMATED_LOTTERY_RATE_LABEL);
  });

  it('搜尋時應正規化臺／台異體字與標點', () => {
    expect(normalizeSearchText(' 臺 北・蘭州 ')).toBe('台北蘭州');

    const schools = buildSchoolLotteryRates(sampleData);
    const [match] = searchSchoolLotteryRates(schools, '台北蘭州');

    expect(match?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(match?.matchScore).toBeGreaterThan(0);
  });

  it('應把資料檔中的行政區搜尋關鍵字納入模糊搜尋', () => {
    const schools = buildSchoolLotteryRates(sampleData);
    const [match] = searchSchoolLotteryRates(schools, '大同區');

    expect(match?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(match?.matchScore).toBe(1);
    expect(match?.searchKeywords[0]).toBe('大同區');
    expect(match?.ageGroups.map((group) => group.ageGroup)).toEqual([
      '5歲',
      '4歲',
      '3歲',
      '2歲專班',
    ]);
  });

  it('同一行政區關鍵字應可找出多間幼兒園並保留原始資料順序', () => {
    const schools = buildSchoolLotteryRates({
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ['大同區'],
        '2歲專班': { 正取: 16, 備取: 39 },
      },
      臺北市大龍峒非營利幼兒園: {
        搜尋關鍵字: ['大同區', '大龍峒'],
        '2歲專班': { 正取: 16, 備取: 40 },
      },
    } satisfies RawLotteryData);

    expect(schools.map((school) => school.schoolName)).toEqual([
      '臺北市蘭州非營利幼兒園',
      '臺北市大龍峒非營利幼兒園',
    ]);

    const matches = searchSchoolLotteryRates(schools, '大同區');
    const dalongdong = matches.find((match) => match.schoolName.includes('大龍峒'));

    expect(matches.map((match) => match.schoolName)).toEqual([
      '臺北市蘭州非營利幼兒園',
      '臺北市大龍峒非營利幼兒園',
    ]);
    expect(dalongdong?.ageGroups[0]?.acceptedCount).toBe(16);
    expect(dalongdong?.ageGroups[0]?.waitlistedCount).toBe(40);
    expect(dalongdong?.ageGroups[0]?.estimatedLotteryRatePercent).toBeCloseTo(28.571, 3);
  });

  it('應正確推導明倫非營利幼兒園四個班齡的估算中籤率', () => {
    const minglunData = {
      臺北市明倫非營利幼兒園: {
        搜尋關鍵字: ['大同區', '臺北市大同區', '明倫'],
        '5歲': { 正取: 3, 備取: 6 },
        '4歲': { 正取: 6, 備取: 4 },
        '3歲': { 正取: 1, 備取: 27 },
        '2歲專班': { 正取: 31, 備取: 133 },
      },
    } satisfies RawLotteryData;

    const [school] = buildSchoolLotteryRates(minglunData);

    expect(school?.schoolName).toBe('臺北市明倫非營利幼兒園');
    expect(school?.ageGroups.map((group) => group.ageGroup)).toEqual([
      '5歲',
      '4歲',
      '3歲',
      '2歲專班',
    ]);

    const ratesByAge = new Map(school?.ageGroups.map((group) => [group.ageGroup, group]));

    expect(ratesByAge.get('5歲')?.estimatedLotteryRatePercent).toBeCloseTo(33.333, 3);
    expect(ratesByAge.get('4歲')?.estimatedLotteryRatePercent).toBeCloseTo(60, 3);
    expect(ratesByAge.get('3歲')?.estimatedLotteryRatePercent).toBeCloseTo(3.571, 3);
    expect(ratesByAge.get('2歲專班')?.estimatedLotteryRatePercent).toBeCloseTo(18.902, 3);

    const schools = buildSchoolLotteryRates(minglunData);
    const [match] = searchSchoolLotteryRates(schools, '明倫');
    expect(match?.schoolName).toBe('臺北市明倫非營利幼兒園');
    expect(match?.matchScore).toBe(1);
  });

  it('不相關關鍵字應回傳空結果', () => {
    const schools = buildSchoolLotteryRates(sampleData);

    expect(searchSchoolLotteryRates(schools, '不存在')).toEqual([]);
  });

  it('應回傳多筆模糊符合結果且排除無關幼兒園', () => {
    const schools = buildSchoolLotteryRates({
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ['大同區'],
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

  it('應處理零分母與無效人數且不產生 NaN 比率', () => {
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

  it('應保留詳細招生資訊並拆出學年與班齡標籤', () => {
    const [record] = buildLotteryRateRecords({
      測試幼兒園: {
        搜尋關鍵字: ['中正區'],
        '3歲（114學年）': {
          正取: 2,
          備取: 20,
          公告缺額: 3,
          總登記人數: 23,
          各序位: {
            '順序1-4': 1,
            順序5: 2,
            順序9: 20,
          },
          身份別: {
            優先順序: {
              申請: 1,
            },
            一般生: {
              缺額: 2,
              申請: 22,
              正取: 2,
              備取: 20,
              中籤率: 0.0909090909,
            },
          },
          優先順序: 1,
          一般缺額: 2,
          一般順序: 22,
          一般順序中籤率: 0.0909090909,
          資料來源: '114學年 3歲',
          備註: '測試備註',
        },
      },
    } satisfies RawLotteryData);

    expect(record?.ageLabel).toBe('3歲');
    expect(record?.schoolYear).toBe('114學年');
    expect(record?.announcedVacancyCount).toBe(3);
    expect(record?.registrationCount).toBe(23);
    expect(record?.priorityApplicantCount).toBe(1);
    expect(record?.generalVacancyCount).toBe(2);
    expect(record?.generalApplicantCount).toBe(22);
    expect(record?.generalAcceptedCount).toBe(2);
    expect(record?.generalWaitlistedCount).toBe(20);
    expect(record?.generalLotteryRatePercent).toBeCloseTo(9.091, 3);
    expect(record?.sequenceCounts).toEqual([
      { label: '順序1-4', count: 1 },
      { label: '順序5', count: 2 },
      { label: '順序9', count: 20 },
    ]);
    expect(record?.sourceLabel).toBe('114學年 3歲');
    expect(record?.note).toBe('測試備註');
  });

  it('應隱藏沒有資訊量的零值序位', () => {
    const [record] = buildLotteryRateRecords({
      測試幼兒園: {
        '3歲（114學年）': {
          正取: 0,
          備取: 0,
          各序位: {
            '順序1-4': 0,
            順序5: 0,
            順序9: 0,
          },
        },
      },
    } satisfies RawLotteryData);

    expect(record?.sequenceCounts).toEqual([]);
  });
});
