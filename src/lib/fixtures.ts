// Offline demo data. Domains here are scraped from fixtures instead of the network,
// and have mock Hunter contacts. All names are fictional.

const page = (title: string, body: string, head = "") =>
  `<!doctype html><html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;

export const FIXTURE_SITES: Record<string, Record<string, string>> = {
  "acmeledger.io": {
    "/": page(
      "Acme Ledger | Close the books in days",
      `<h1>Accounting automation for B2B finance teams</h1>
       <p>Acme Ledger is a SaaS platform that reconciles payments, automates month-end close and syncs with your ERP via API.</p>
       <p>Trusted by 300+ mid-market customers.</p>`,
    ),
    "/about": page(
      "About | Acme Ledger",
      `<p>Founded in 2021, we are a team of 85 people across Bengaluru and London. Series B, backed by enterprise software investors.</p>`,
    ),
    "/careers": page(
      "Careers | Acme Ledger",
      `<h2>Open roles</h2><ul>
        <li class="job">Senior Backend Engineer</li>
        <li class="job">Enterprise Account Executive</li>
        <li class="job">Security Engineer</li>
        <li class="job">Product Designer</li>
        <li class="job">Solutions Engineer (Enterprise)</li>
        <li class="job">Data Engineer</li></ul>`,
    ),
    "/security": page(
      "Security | Acme Ledger",
      `<h1>Security at Acme Ledger</h1><p>All data is encrypted in transit and at rest. We run annual penetration tests.</p>
       <!-- TODO: add SOC 2 Type II badge here once the audit completes -->`,
    ),
  },
  "orbitops.dev": {
    "/": page(
      "OrbitOps - Incident response for engineering teams",
      `<h1>Incident management platform for engineering teams</h1>
       <p>OrbitOps is B2B software: on-call scheduling, alert routing and postmortems, with integrations for Slack, PagerDuty and Datadog.</p>`,
    ),
    "/careers": page(
      "Jobs at OrbitOps",
      `<h2>Join us</h2>
       <a href="https://boards.greenhouse.io/orbitops/jobs/1">Staff Platform Engineer</a>
       <a href="https://boards.greenhouse.io/orbitops/jobs/2">Customer Success Manager</a>
       <a href="https://boards.greenhouse.io/orbitops/jobs/3">Head of Compliance</a>
       <a href="https://boards.greenhouse.io/orbitops/jobs/4">Frontend Engineer</a>
       <script src="https://boards.greenhouse.io/embed/job_board/js?for=orbitops"></script>`,
    ),
    "/trust": page(
      "Trust | OrbitOps",
      `<h1>Trust center</h1><p>Our trust center is coming soon.</p>
       <img src="/img/iso27001-badge-pending.png" alt="">`,
    ),
    "/company": page(
      "Company | OrbitOps",
      `<p>We're 40 people, remote-first, serving 150 engineering teams.</p>`,
    ),
  },
  "vaultly.com": {
    "/": page(
      "Vaultly - Secrets management for enterprises",
      `<h1>Enterprise secrets management platform</h1><p>SaaS for B2B security teams. 120 employees worldwide.</p>
       <div class="badges">SOC 2 Type II certified · ISO 27001</div>`,
    ),
    "/careers": page(
      "Careers",
      `<ul><li class="job">SRE</li><li class="job">AE</li><li class="job">PM</li><li class="job">Designer</li><li class="job">Recruiter</li></ul>`,
    ),
  },
  "brewbox.shop": {
    "/": page(
      "BrewBox - Fresh coffee, delivered",
      `<h1>Coffee subscriptions for coffee lovers</h1><p>Add to cart. Free shipping on your first box. Shop beans and gifts.</p>`,
    ),
    "/about": page("About", `<p>We're a team of 30 people who love coffee.</p>`),
    "/careers": page(
      "Careers",
      `<ul><li class="job">Barista Trainer</li><li class="job">Warehouse Associate</li><li class="job">Social Media Manager</li></ul>`,
    ),
  },
  "tinytask.app": {
    "/": page(
      "TinyTask - Task boards for small agencies",
      `<h1>Project management software for B2B agencies</h1><p>A SaaS platform for client teams.</p>`,
    ),
    "/about": page("About", `<p>We are a team of 8 people.</p>`),
    "/careers": page("Careers", `<ul><li class="job">Full-stack Engineer</li></ul>`),
  },
  "quietledger.io": {
    "/": page(
      "QuietLedger - Spend controls for finance teams",
      `<h1>Spend management software for B2B finance teams</h1><p>A SaaS platform with approvals, cards and an API.</p>`,
    ),
    "/careers": page(
      "Careers",
      `<ul><li class="job">Backend Engineer</li><li class="job">Enterprise Account Executive</li><li class="job">Customer Success Lead</li></ul>`,
    ),
  },
  "medsync.health": {
    "/": page(
      "MedSync - Scheduling for clinics",
      `<h1>Patient scheduling platform for clinic groups</h1><p>B2B SaaS used by 900 clinics. HIPAA compliant.</p>`,
    ),
    "/about": page("About", `<p>Over 60 employees.</p>`),
    "/careers": page(
      "Careers",
      `<ul><li class="job">Backend Engineer</li><li class="job">Implementation Manager</li><li class="job">QA Engineer</li><li class="job">Sales Development Rep</li></ul>`,
    ),
  },
};

export interface FixtureContact {
  first_name: string;
  last_name: string;
  value: string;
  position: string;
  seniority: string;
  confidence: number;
}

export const FIXTURE_CONTACTS: Record<string, FixtureContact[]> = {
  "acmeledger.io": [
    { first_name: "Tom", last_name: "Fisher", value: "tom@acmeledger.io", position: "Sales Manager", seniority: "senior", confidence: 92 },
    { first_name: "Priya", last_name: "Raman", value: "priya@acmeledger.io", position: "Head of Security", seniority: "executive", confidence: 95 },
    { first_name: "Daniel", last_name: "Cho", value: "daniel@acmeledger.io", position: "CTO", seniority: "executive", confidence: 97 },
    { first_name: "Meera", last_name: "Shah", value: "meera@acmeledger.io", position: "CEO & Co-founder", seniority: "executive", confidence: 99 },
    { first_name: "Ana", last_name: "Lopez", value: "ana@acmeledger.io", position: "Senior Software Engineer", seniority: "senior", confidence: 80 },
    { first_name: "Raj", last_name: "Menon", value: "raj@acmeledger.io", position: "VP Operations", seniority: "executive", confidence: 88 },
  ],
  "orbitops.dev": [
    { first_name: "Sam", last_name: "Okafor", value: "sam@orbitops.dev", position: "Founder & CEO", seniority: "executive", confidence: 98 },
    { first_name: "Lena", last_name: "Park", value: "lena@orbitops.dev", position: "VP Engineering", seniority: "executive", confidence: 94 },
  ],
  "vaultly.com": [
    { first_name: "Chris", last_name: "Ng", value: "chris@vaultly.com", position: "CTO", seniority: "executive", confidence: 90 },
  ],
  "quietledger.io": [
    { first_name: "Nina", last_name: "Rao", value: "nina@quietledger.io", position: "CTO", seniority: "executive", confidence: 93 },
  ],
  "medsync.health": [
    { first_name: "Ola", last_name: "Berg", value: "ola@medsync.health", position: "CEO", seniority: "executive", confidence: 90 },
  ],
};

export const DEMO_DOMAINS = Object.keys(FIXTURE_SITES);
