import {
  ESTIMATED_LOTTERY_RATE_LABEL,
  type KindergartenDataset,
  type RawLotteryData,
} from './lottery-data.model';
import {
  adaptKindergartenDatasetToRawLotteryData,
  buildLotteryRateRecords,
  buildSchoolLotteryRates,
  calculateSelectedSequenceLotteryRate,
  findDefaultGeneralSequenceLabel,
  getGeneralSequenceLabel,
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

  it('搜尋歷史校名別名時應顯示同一幼兒園的三個學年度資料', () => {
    const schools = buildSchoolLotteryRates({
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ['蘭州非營利幼兒園', '蘭州', '大同區'],
        '2歲專班（113學年）': { 正取: 0, 備取: 68 },
        '5歲（114學年）': { 正取: 0, 備取: 2 },
        '5歲（115學年）': { 正取: 4, 備取: 6 },
      },
    } satisfies RawLotteryData);

    const matches = searchSchoolLotteryRates(schools, '蘭州非營利幼兒園');
    const [match] = matches;
    const schoolYears = Array.from(
      new Set(
        match?.ageGroups
          .map((group) => group.schoolYear)
          .filter((schoolYear): schoolYear is string => schoolYear !== null) ?? [],
      ),
    ).sort((left, right) => left.localeCompare(right, 'zh-Hant'));

    expect(matches).toHaveLength(1);
    expect(match?.schoolName).toBe('臺北市蘭州非營利幼兒園');
    expect(match?.matchScore).toBe(1);
    expect(schoolYears).toEqual(['113學年', '114學年', '115學年']);
  });

  it('115 學年度即時資料含各序位時應顯示序位登記人數', () => {
    const [school] = buildSchoolLotteryRates({
      臺北市蘭州非營利幼兒園: {
        搜尋關鍵字: ['蘭州非營利幼兒園', '蘭州'],
        '4歲（115學年）': {
          正取: 11,
          備取: 9,
          公告缺額: 11,
          總登記人數: 9,
          各序位: {
            '順序1-4': 1,
            順序5: 0,
            順序6: 1,
            順序7: 0,
            順序8: 2,
            順序9: 9,
          },
          優先順序: 4,
          一般順序: 9,
        },
      },
    } satisfies RawLotteryData);
    const record = school?.ageGroups[0];

    expect(record?.schoolYear).toBe('115學年');
    expect(record?.sequenceCounts).toEqual([
      { label: '順序1-4', count: 1 },
      { label: '順序6', count: 1 },
      { label: '順序8', count: 2 },
      { label: '順序9', count: 9 },
    ]);
    expect(record?.priorityApplicantCount).toBe(4);
    expect(record?.generalApplicantCount).toBe(9);
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

  it('應將 Worker schemaVersion 2 資料轉換成現有抽籤資料格式', () => {
    const workerData = {
      schemaVersion: 2,
      source: 'cloudflare-worker',
      updatedAt: '2026-05-26T00:00:00.000Z',
      timezone: 'Asia/Taipei',
      public: {
        type: 'public',
        name: '公立幼兒園',
        baseUrl: 'https://example.test/public',
        updatedAt: '2026-05-26T00:00:00.000Z',
        districts: [
          {
            districtCode: '103',
            districtName: '大同區',
            classes: [
              {
                className: '5歲',
                fetchedAt: '2026-05-26T00:00:00.000Z',
                sourceUrl: 'https://example.test/public/5',
                items: [
                  {
                    id: 'public-103-5-1',
                    schoolName: '臺北市雲端幼兒園',
                    districtCode: '103',
                    districtName: '大同區',
                    sourceType: 'public',
                    className: '5歲',
                    availableQuota: 10,
                    totalQuota: 12,
                    waitingCount: 15,
                    registeredCount: 30,
                  },
                ],
              },
              {
                className: '3歲',
                fetchedAt: '2026-05-26T00:00:00.000Z',
                sourceUrl: 'https://example.test/public/3',
                items: [
                  {
                    id: 'public-103-3-1',
                    schoolName: '臺北市雲端幼兒園',
                    districtCode: '103',
                    districtName: '大同區',
                    sourceType: 'public',
                    className: '3歲',
                    totalQuota: 8,
                    waitingCount: null,
                    registeredCount: 12,
                  },
                ],
              },
            ],
          },
        ],
      },
      nonProfit: {
        type: 'nonProfit',
        name: '非營利幼兒園',
        baseUrl: 'https://example.test/nonprofit',
        updatedAt: '2026-05-26T00:00:00.000Z',
        districts: [],
      },
    } satisfies KindergartenDataset;

    const rawData = adaptKindergartenDatasetToRawLotteryData(workerData);
    expect(rawData['臺北市雲端幼兒園']?.['搜尋關鍵字']).toEqual(['大同區', '公立幼兒園', 'public']);
    expect(rawData['臺北市雲端幼兒園']?.['5歲（115學年）']).toMatchObject({
      正取: 10,
      備取: 15,
      公告缺額: 10,
      總登記人數: 30,
      資料來源: '公立幼兒園 / public',
    });
    expect(rawData['臺北市雲端幼兒園']?.['3歲（115學年）']).toMatchObject({
      正取: 8,
      備取: 12,
      公告缺額: 8,
      總登記人數: 12,
    });

    const schools = buildSchoolLotteryRates(workerData);
    const [school] = schools;
    const ratesByAge = new Map(school?.ageGroups.map((group) => [group.ageGroup, group]));

    expect(school?.schoolName).toBe('臺北市雲端幼兒園');
    expect(school?.ageGroups.map((group) => group.ageGroup)).toEqual([
      '5歲（115學年）',
      '3歲（115學年）',
    ]);
    expect(ratesByAge.get('5歲（115學年）')?.schoolYear).toBe('115學年');
    expect(ratesByAge.get('5歲（115學年）')?.estimatedLotteryRatePercent).toBeCloseTo(40);
    expect(ratesByAge.get('3歲（115學年）')?.estimatedLotteryRatePercent).toBeCloseTo(40);

    const [match] = searchSchoolLotteryRates(schools, '大同區');
    expect(match?.schoolName).toBe('臺北市雲端幼兒園');
    expect(match?.matchScore).toBe(1);
  });

  it('應將大龍峒即時無法估算班齡標示為 115 學年', () => {
    const schools = buildSchoolLotteryRates({
      臺北市大龍峒非營利幼兒園: {
        搜尋關鍵字: ['大龍峒非營利幼兒園', '大龍峒'],
        '5歲（115學年）': { 正取: 0, 備取: 0, 資料來源: '115學年 5歲' },
        '2歲專班（114學年）': { 正取: 7, 備取: 40, 資料來源: '114學年 2歲專班' },
      },
    } satisfies RawLotteryData);

    const [match] = searchSchoolLotteryRates(schools, '大龍峒');
    const noEstimateRecord = match?.ageGroups.find((group) => group.ageLabel === '5歲');

    expect(match?.schoolName).toBe('臺北市大龍峒非營利幼兒園');
    expect(match?.matchScore).toBe(1);
    expect(noEstimateRecord?.schoolYear).toBe('115學年');
    expect(noEstimateRecord?.estimatedLotteryRate).toBeNull();
    expect(noEstimateRecord?.dataQualityIssues[0]?.message).toContain('5歲（115學年）');
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
    expect(record?.priorityAcceptedCount).toBe(1);
    expect(record?.priorityLotteryRatePercent).toBeCloseTo(100);
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

  it('應由公告缺額與一般缺額推導優先生中籤率並處理邊界案例', () => {
    const records = buildLotteryRateRecords({
      臺北市優先生測試幼兒園: {
        '5歲': {
          正取: 5,
          備取: 5,
          公告缺額: 5,
          身份別: {
            優先順序: { 申請: 3 },
            一般生: { 缺額: 2, 申請: 10, 正取: 2, 備取: 8, 中籤率: 0.2 },
          },
        },
        '4歲': {
          正取: 5,
          備取: 5,
          公告缺額: 5,
          身份別: {
            優先順序: { 申請: 10 },
            一般生: { 缺額: 2, 申請: 10, 正取: 2, 備取: 8 },
          },
        },
        '3歲': {
          正取: 0,
          備取: 10,
          公告缺額: 2,
          身份別: {
            優先順序: { 申請: 0 },
            一般生: { 缺額: 2, 申請: 10, 正取: 0, 備取: 10 },
          },
        },
        '2歲專班': {
          正取: 0,
          備取: 10,
          公告缺額: 2,
          身份別: {
            優先順序: { 申請: 5 },
            一般生: { 缺額: 5, 申請: 10, 正取: 0, 備取: 10 },
          },
        },
        混齡班: {
          正取: 0,
          備取: 10,
          身份別: {
            優先順序: { 申請: 4 },
            一般生: { 缺額: 2, 申請: 10, 正取: 0, 備取: 10 },
          },
        },
        舊欄位班: {
          正取: 4,
          備取: 6,
          公告缺額: 6,
          優先順序: 4,
          一般缺額: 2,
          一般順序: 10,
          一般順序中籤率: 0.4,
        },
      },
    } satisfies RawLotteryData);
    const recordsByAge = new Map(records.map((record) => [record.ageGroup, record]));

    expect(recordsByAge.get('5歲')?.priorityAcceptedCount).toBe(3);
    expect(recordsByAge.get('5歲')?.priorityLotteryRatePercent).toBeCloseTo(100);
    expect(recordsByAge.get('5歲')?.generalLotteryRatePercent).toBeCloseTo(20);
    expect(recordsByAge.get('4歲')?.priorityAcceptedCount).toBe(3);
    expect(recordsByAge.get('4歲')?.priorityLotteryRatePercent).toBeCloseTo(30);
    expect(recordsByAge.get('3歲')?.priorityAcceptedCount).toBe(0);
    expect(recordsByAge.get('3歲')?.priorityLotteryRate).toBeNull();
    expect(recordsByAge.get('2歲專班')?.priorityAcceptedCount).toBe(0);
    expect(recordsByAge.get('2歲專班')?.priorityLotteryRatePercent).toBeCloseTo(0);
    expect(recordsByAge.get('混齡班')?.priorityAcceptedCount).toBeNull();
    expect(recordsByAge.get('混齡班')?.priorityLotteryRate).toBeNull();
    expect(recordsByAge.get('舊欄位班')?.priorityAcceptedCount).toBe(4);
    expect(recordsByAge.get('舊欄位班')?.priorityLotteryRatePercent).toBeCloseTo(100);
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

  it('應以選取序位與剩餘缺額計算收滿前、收滿當下與收滿後中籤率', () => {
    const sequenceCounts = [
      { label: '順序1', count: 3 },
      { label: '順序2', count: 4 },
      { label: '順序3', count: 6 },
      { label: '順序4', count: 5 },
    ];

    const beforeThreshold = calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: 10,
      sequenceCounts,
      selectedSequenceLabel: '順序2',
    });
    const fillThreshold = calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: 10,
      sequenceCounts,
      selectedSequenceLabel: '順序3',
    });
    const afterThreshold = calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: 10,
      sequenceCounts,
      selectedSequenceLabel: '順序4',
    });

    expect(beforeThreshold?.cumulativeApplicantCountBefore).toBe(3);
    expect(beforeThreshold?.remainingVacancyCount).toBe(7);
    expect(beforeThreshold?.selectedAcceptedCount).toBe(4);
    expect(beforeThreshold?.lotteryRatePercent).toBeCloseTo(100);
    expect(fillThreshold?.cumulativeApplicantCountBefore).toBe(7);
    expect(fillThreshold?.remainingVacancyCount).toBe(3);
    expect(fillThreshold?.selectedAcceptedCount).toBe(3);
    expect(fillThreshold?.lotteryRatePercent).toBeCloseTo(50);
    expect(afterThreshold?.cumulativeApplicantCountBefore).toBe(13);
    expect(afterThreshold?.remainingVacancyCount).toBe(0);
    expect(afterThreshold?.selectedAcceptedCount).toBe(0);
    expect(afterThreshold?.lotteryRatePercent).toBeCloseTo(0);
  });

  it('一般生序位應固定為公立順序8、非營利順序9且不被舊的一般順序覆蓋', () => {
    const records = buildLotteryRateRecords({
      臺北市公立測試幼兒園: {
        '4歲': {
          正取: 8,
          備取: 20,
          公告缺額: 8,
          一般順序: 20,
          各序位: {
            順序1: 4,
            順序8: 6,
            順序15: 20,
          },
        },
      },
      臺北市非營利測試幼兒園: {
        '4歲': {
          正取: 9,
          備取: 20,
          公告缺額: 9,
          一般順序: 20,
          各序位: {
            順序1: 4,
            順序8: 6,
            順序9: 20,
          },
        },
      },
    } satisfies RawLotteryData);
    const publicRecord = records.find((record) => record.schoolName.includes('公立'));
    const nonprofitRecord = records.find((record) => record.schoolName.includes('非營利'));

    expect(getGeneralSequenceLabel('臺北市公立測試幼兒園')).toBe('順序8');
    expect(getGeneralSequenceLabel('臺北市非營利測試幼兒園')).toBe('順序9');
    expect(publicRecord?.generalApplicantCount).toBe(20);
    expect(nonprofitRecord?.generalApplicantCount).toBe(20);
    expect(publicRecord ? findDefaultGeneralSequenceLabel(publicRecord) : null).toBe('順序8');
    expect(nonprofitRecord ? findDefaultGeneralSequenceLabel(nonprofitRecord) : null).toBe('順序9');
  });

  it('選取序位遇到缺少公告缺額、零申請或不存在標籤時應回傳 null 比率', () => {
    const zeroApplicantRate = calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: 10,
      sequenceCounts: [{ label: '順序8', count: 0 }],
      selectedSequenceLabel: '順序8',
    });
    const missingVacancyRate = calculateSelectedSequenceLotteryRate({
      announcedVacancyCount: null,
      sequenceCounts: [{ label: '順序8', count: 3 }],
      selectedSequenceLabel: '順序8',
    });

    expect(zeroApplicantRate?.selectedAcceptedCount).toBe(0);
    expect(zeroApplicantRate?.lotteryRate).toBeNull();
    expect(zeroApplicantRate?.lotteryRatePercent).toBeNull();
    expect(missingVacancyRate?.remainingVacancyCount).toBeNull();
    expect(missingVacancyRate?.selectedAcceptedCount).toBeNull();
    expect(missingVacancyRate?.lotteryRate).toBeNull();
    expect(
      calculateSelectedSequenceLotteryRate({
        announcedVacancyCount: 10,
        sequenceCounts: [{ label: '順序8', count: 3 }],
        selectedSequenceLabel: '順序9',
      }),
    ).toBeNull();
  });
});
