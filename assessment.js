// Healthcare Risk Assessment - Node.js Solution
// Run with: node assessment.js

const API_BASE_URL = 'https://assessment.ksensetech.com/api';
const API_KEY = 'ak_029994f59963532d3941aca81718532b519328faffd9a14a';

// Utility function to delay between requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry logic
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        console.log(`Rate limited, waiting ${2000 * (i + 1)}ms...`);
        await delay(2000 * (i + 1));
        continue;
      }
      
      if (response.status >= 500) {
        console.log(`Server error (${response.status}), retrying...`);
        await delay(1000 * (i + 1));
        continue;
      }
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      return await response.json();
    } catch (err) {
      console.error(`Attempt ${i + 1} failed:`, err.message);
      if (i === maxRetries - 1) throw err;
      await delay(1000 * (i + 1));
    }
  }
}

// Parse blood pressure string
function parseBloodPressure(bp) {
  if (!bp || typeof bp !== 'string') return null;
  
  const parts = bp.split('/');
  if (parts.length !== 2) return null;
  
  const systolic = parseInt(parts[0].trim());
  const diastolic = parseInt(parts[1].trim());
  
  if (isNaN(systolic) || isNaN(diastolic)) return null;
  
  return { systolic, diastolic };
}

// Calculate blood pressure risk score
function calculateBPRisk(bp) {
  const parsed = parseBloodPressure(bp);
  if (!parsed) return 0;
  
  const { systolic, diastolic } = parsed;
  
  // Stage 2: Systolic ≥140 OR Diastolic ≥90
  if (systolic >= 140 || diastolic >= 90) return 4;
  
  // Stage 1: Systolic 130-139 OR Diastolic 80-89
  if (systolic >= 130 || diastolic >= 80) return 3;
  
  // Elevated: Systolic 120-129 AND Diastolic <80
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) return 2;
  
  // Normal: Systolic <120 AND Diastolic <80
  if (systolic < 120 && diastolic < 80) return 1;
  
  return 0;
}

// Calculate temperature risk score
function calculateTempRisk(temp) {
  if (temp === null || temp === undefined || temp === '') return 0;
  
  const tempNum = parseFloat(temp);
  if (isNaN(tempNum)) return 0;
  
  if (tempNum >= 101.0) return 2;
  if (tempNum >= 99.6) return 1;
  return 0;
}

// Calculate age risk score
function calculateAgeRisk(age) {
  if (age === null || age === undefined || age === '') return 0;
  
  const ageNum = parseInt(age);
  if (isNaN(ageNum)) return 0;
  
  if (ageNum > 65) return 2;
  if (ageNum >= 40) return 1;
  return 1; // Under 40
}

// Check if patient has data quality issues
function hasDataQualityIssues(patient) {
  // Check BP
  const bpParsed = parseBloodPressure(patient.blood_pressure);
  if (!bpParsed) return true;
  
  // Check temperature
  const temp = parseFloat(patient.temperature);
  if (isNaN(temp) || patient.temperature === null || patient.temperature === undefined || patient.temperature === '') {
    return true;
  }
  
  // Check age
  const age = parseInt(patient.age);
  if (isNaN(age) || patient.age === null || patient.age === undefined || patient.age === '') {
    return true;
  }
  
  return false;
}

// Fetch all patients
async function fetchAllPatients() {
  console.log('Starting to fetch patients...\n');
  const allPatients = [];
  let page = 1;
  let hasMore = true;
  let totalPages = null;
  
  while (hasMore) {
    console.log(`Fetching page ${page}...`);
    
    const data = await fetchWithRetry(
      `${API_BASE_URL}/patients?page=${page}&limit=10`,
      {
        headers: { 'x-api-key': API_KEY }
      }
    );
    
    // Handle inconsistent API responses
    const patients = Array.isArray(data.data) ? data.data : 
                     Array.isArray(data) ? data :
                     data.patients ? (Array.isArray(data.patients) ? data.patients : []) :
                     [];
    
    if (patients.length === 0) {
      console.log(`  ⚠️  No patients found on page ${page}, stopping.`);
      break;
    }
    
    allPatients.push(...patients);
    
    // Store total pages from first response
    if (page === 1 && data.pagination?.totalPages) {
      totalPages = data.pagination.totalPages;
    }
    
    console.log(`  Retrieved ${patients.length} patients`);
    console.log(`  Total so far: ${allPatients.length}/${data.pagination?.total || '?'}`);
    
    // Check if there are more pages - try multiple methods
    hasMore = data.pagination?.hasNext ?? false;
    
    // If pagination says no more but we haven't reached expected pages, continue
    if (!hasMore && totalPages && page < totalPages) {
      console.log(`  ⚠️  API says no more pages, but ${page} < ${totalPages}, continuing...`);
      hasMore = true;
    }
    
    // Also check if we got a full page of results (might be more)
    if (!hasMore && patients.length >= 10) {
      console.log(`  ⚠️  Got full page of 10, trying next page anyway...`);
      hasMore = true;
    }
    
    page++;
    
    // Safety limit to prevent infinite loops
    if (page > 20) {
      console.log(`  ⚠️  Reached safety limit of 20 pages, stopping.`);
      break;
    }
    
    // Rate limiting delay
    if (hasMore) await delay(500);
  }
  
  console.log(`\n✓ Fetched all ${allPatients.length} patients\n`);
  return allPatients;
}

// Analyze patients
function analyzePatients(patients) {
  console.log('Analyzing patients...\n');
  
  const highRiskPatients = [];
  const feverPatients = [];
  const dataQualityIssues = [];
  const debugInfo = [];
  
  patients.forEach(patient => {
    const bpRisk = calculateBPRisk(patient.blood_pressure);
    const tempRisk = calculateTempRisk(patient.temperature);
    const ageRisk = calculateAgeRisk(patient.age);
    const totalRisk = bpRisk + tempRisk + ageRisk;
    
    // Store debug info for high-risk edge cases
    if (totalRisk >= 3) {
      debugInfo.push({
        id: patient.patient_id,
        bp: patient.blood_pressure,
        bpRisk,
        temp: patient.temperature,
        tempRisk,
        age: patient.age,
        ageRisk,
        totalRisk,
        isHighRisk: totalRisk >= 4
      });
    }
    
    // High risk patients (score >= 4)
    if (totalRisk >= 4) {
      highRiskPatients.push(patient.patient_id);
    }
    
    // Fever patients (temp >= 99.6)
    const temp = parseFloat(patient.temperature);
    if (!isNaN(temp) && temp >= 99.6) {
      feverPatients.push(patient.patient_id);
    }
    
    // Data quality issues
    if (hasDataQualityIssues(patient)) {
      dataQualityIssues.push(patient.patient_id);
    }
  });
  
  console.log(`High Risk Patients (score ≥ 4): ${highRiskPatients.length}`);
  console.log(`Fever Patients (temp ≥ 99.6°F): ${feverPatients.length}`);
  console.log(`Data Quality Issues: ${dataQualityIssues.length}\n`);
  
  // Show patients near the threshold
  console.log('Patients with Total Risk >= 3 (for debugging):');
  console.log('─────────────────────────────────────────────────────────────────');
  debugInfo.forEach(p => {
    const marker = p.isHighRisk ? '🚨' : '⚠️';
    console.log(`${marker} ${p.id}: Total=${p.totalRisk} (BP=${p.bpRisk}, Temp=${p.tempRisk}, Age=${p.ageRisk})`);
    console.log(`   BP: ${p.bp}, Temp: ${p.temp}, Age: ${p.age}`);
  });
  console.log('─────────────────────────────────────────────────────────────────\n');
  
  return {
    high_risk_patients: highRiskPatients,
    fever_patients: feverPatients,
    data_quality_issues: dataQualityIssues
  };
}

// Submit assessment
async function submitAssessment(results) {
  console.log('Submitting assessment...\n');
  
  const response = await fetch(`${API_BASE_URL}/submit-assessment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY
    },
    body: JSON.stringify(results)
  });
  
  if (!response.ok) {
    throw new Error(`Submission failed: ${response.status}`);
  }
  
  const data = await response.json();
  return data;
}

// Display results
function displayResults(submissionResult) {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    ASSESSMENT RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const { results } = submissionResult;
  
  console.log(`Score: ${results.score.toFixed(2)} / 100 (${results.percentage}%)`);
  console.log(`Status: ${results.status}`);
  console.log(`Attempt: ${results.attempt_number} of 3`);
  console.log(`Remaining Attempts: ${results.remaining_attempts}`);
  if (results.is_personal_best) {
    console.log('🎉 Personal Best!\n');
  } else {
    console.log('');
  }
  
  console.log('Breakdown:');
  console.log('─────────────────────────────────────────────────────────────────');
  Object.entries(results.breakdown).forEach(([key, data]) => {
    console.log(`\n${key.replace('_', ' ').toUpperCase()}:`);
    console.log(`  Score: ${data.score} / ${data.max}`);
    console.log(`  Matches: ${data.matches}`);
    console.log(`  Submitted: ${data.submitted}`);
    console.log(`  Correct: ${data.correct}`);
  });
  
  if (results.feedback) {
    console.log('\n─────────────────────────────────────────────────────────────────');
    
    if (results.feedback.strengths?.length > 0) {
      console.log('\nStrengths:');
      results.feedback.strengths.forEach(strength => {
        console.log(`  ${strength}`);
      });
    }
    
    if (results.feedback.issues?.length > 0) {
      console.log('\nAreas for Improvement:');
      results.feedback.issues.forEach(issue => {
        console.log(`  ${issue}`);
      });
    }
  }
  
  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

// Main function
async function main() {
  try {
    const patients = await fetchAllPatients();
    
    const results = analyzePatients(patients);
    
    console.log('Submitting:');
    console.log(`  High Risk: ${results.high_risk_patients.length} patients`);
    console.log(`  Fever: ${results.fever_patients.length} patients`);
    console.log(`  Data Quality Issues: ${results.data_quality_issues.length} patients\n`);
    
    const submissionResult = await submitAssessment(results);
    
    displayResults(submissionResult);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();