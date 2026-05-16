
const fs = require('fs');

// 2026년 데이터를 로드하여 평균 모델 추출 (여기서는 단순화된 모델 사용)
// 실제로는 consolidated_trend.json을 분석하여 사업장별 평균을 구함
const SITES = ["H1", "16L", "17L", "V1L", "DSR", "미래기술캠퍼스", "SR1", "SR3", "6L", "sdr", "미캠"];
const MEALS = ["조식", "중식", "석식", "야식"];

function generateSynthetic2025() {
    const results = [];
    const startDate = new Date("2025-01-01");
    const endDate = new Date("2025-12-31");
    
    // 2025년 주요 공휴일 (식수 70~80% 감소 가정)
    const holidays2025 = [
        "2025-01-01", // 신정
        "2025-01-28", "2025-01-29", "2025-01-30", // 설날
        "2025-03-01", // 삼일절
        "2025-05-05", // 어린이날
        "2025-05-06", // 부처님오신날
        "2025-06-06", // 현충일
        "2025-08-15", // 광복절
        "2025-10-03", // 개천절
        "2025-10-05", "2025-10-06", "2025-10-07", // 추석
        "2025-10-09", // 한글날
        "2025-12-25"  // 크리스마스
    ];

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().slice(0, 10);
        const day = d.getDay();
        const isWeekend = (day === 0 || day === 6);
        const isHoliday = holidays2025.includes(dateStr);
        
        SITES.forEach(site => {
            MEALS.forEach(meal => {
                let base = 800; // 기본값
                if (site === "H1") base = 900;
                if (site === "DSR") base = 1200;
                
                // 끼니별 비중
                const mealWeight = { "조식": 0.7, "중식": 1.2, "석식": 0.9, "야식": 0.4 }[meal];
                let val = base * mealWeight;
                
                // 요일/휴일 보정
                if (isHoliday) val *= 0.15;
                else if (isWeekend) val *= 0.25;
                else if (day === 5) val *= 0.85; // 금요일 감소
                
                // 계절 보정
                const month = d.getMonth() + 1;
                if (month === 8) val *= 0.8; // 여름 휴가철
                if (month === 12) val *= 0.9; // 연말
                
                // 기온 데이터 주입 (서울 월평균 기온 기준 근사치)
                const monthlyAvgTemp = [ -2.4, 0.4, 5.7, 12.5, 17.8, 22.2, 24.9, 25.7, 21.2, 14.8, 7.2, 0.2 ][month-1];
                const tempNoise = (Math.random() * 4 - 2); // +- 2도 노이즈
                const temp = Number((monthlyAvgTemp + tempNoise).toFixed(1));

                // 노이즈 추가 (실제 데이터 느낌)
                val *= (0.95 + Math.random() * 0.1);
                
                results.push({
                    date: dateStr,
                    region: "수도권",
                    siteName: site,
                    meal: meal,
                    predicted: Math.round(val * 1.05),
                    actual: Math.round(val),
                    accuracy: 95,
                    temp: temp, // 기온 정보 추가
                    note: "Synthetic-2025-History"
                });
            });
        });
    }
    return results;
}

const data = generateSynthetic2025();
fs.writeFileSync('synthetic_2025_baseline.json', JSON.stringify(data, null, 2));
console.log(`Generated ${data.length} synthetic records for 2025.`);
