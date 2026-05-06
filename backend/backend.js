/* =============================================
   AquaSense AWS Backend Dashboard – JavaScript
   ============================================= */
const $ = id => document.getElementById(id);
const rand = (mn,mx) => Math.random()*(mx-mn)+mn;
const randInt = (mn,mx) => Math.floor(rand(mn,mx));

// ---- CLOCK ----
function tickClock() {
  const now = new Date();
  $('live-clock').textContent = now.toISOString().replace('T',' ').substring(0,19) + ' UTC';
}
setInterval(tickClock, 1000); tickClock();

// ---- TABS ----
function switchTab(name, btn) {
  document.querySelectorAll('.tab-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('active'));
  $('page-' + name)?.classList.add('active');
  btn.classList.add('active');
  tabInits[name]?.();
}
const tabInits = {};
let inited = {};

// ---- CHART HELPER ----
const charts = {};
function lineChart(id, labels, datasets, yLabel='') {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: { duration: 500 },
      plugins: { legend: { labels: { color:'#94a3b8', font:{size:10}, boxWidth:10 } } },
      scales: {
        x: { ticks:{ color:'#4a5568', font:{size:10}, maxTicksLimit:8 }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y: { ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' }, title:{ display:!!yLabel, text:yLabel, color:'#4a5568', font:{size:10} } }
      },
      responsive: true, maintainAspectRatio: true
    }
  });
}
function doughnutChart(id, labels, data, colors) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderColor:'#0c1424', borderWidth:2, hoverOffset:5 }] },
    options: { cutout:'60%', plugins:{ legend:{ position:'bottom', labels:{ color:'#94a3b8', font:{size:10}, boxWidth:10, padding:8 } } }, responsive:true, maintainAspectRatio:false }
  });
}
function barChart(id, labels, datasets) {
  const ctx = $(id)?.getContext('2d'); if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      animation:{duration:500},
      plugins:{ legend:{ labels:{ color:'#94a3b8', font:{size:10}, boxWidth:10 } } },
      scales:{
        x:{ ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } },
        y:{ ticks:{ color:'#4a5568', font:{size:10} }, grid:{ color:'rgba(255,255,255,0.04)' } }
      },
      responsive:true, maintainAspectRatio:true
    }
  });
}
function genTs(points=20, intervalMin=3) {
  const labels=[]; const now=new Date();
  for(let i=points-1;i>=0;i--){ const t=new Date(now-i*intervalMin*60000); labels.push(t.getHours()+':'+String(t.getMinutes()).padStart(2,'0')); }
  return labels;
}
function genData(base,noise,points=20){ return Array.from({length:points},()=>Math.max(0,base+rand(-noise,noise))); }

// ========= OVERVIEW =========
function initOverview() {
  if (inited.overview) return; inited.overview=true;
  renderArchDiagram();
  animOverviewStats();
}
tabInits.overview = initOverview;

function renderArchDiagram() {
  const d = $('arch-diagram'); if (!d) return;
  d.innerHTML = `
  <div style="font-size:11px;color:#4a5568;margin-bottom:16px;font-family:'JetBrains Mono',monospace">
    VPC: vpc-0a1b2c3d · CIDR 10.0.0.0/16 · Region: ap-south-1 · 2 AZs
  </div>
  <div class="arch-row">
    <div class="arch-zone internet">
      <div class="arch-zone-title">Internet / Clients</div>
      <div class="arch-services">
        <div class="arch-svc blue">🌐 Smart Meters (IoT)</div>
        <div class="arch-svc blue">👤 Web Customers</div>
        <div class="arch-svc blue">📱 Mobile App</div>
      </div>
    </div>
  </div>
  <div class="arch-arrow">↓ HTTPS / MQTT</div>
  <div class="arch-row">
    <div class="arch-zone public">
      <div class="arch-zone-title">Public Layer – CloudFront · Route 53 · WAF · Shield</div>
      <div class="arch-services">
        <div class="arch-svc orange">🛡 AWS WAF</div>
        <div class="arch-svc orange">☁️ CloudFront CDN</div>
        <div class="arch-svc orange">🌍 Route 53</div>
        <div class="arch-svc orange">⚖️ App Load Balancer</div>
        <div class="arch-svc blue">📡 IoT Core</div>
      </div>
    </div>
  </div>
  <div class="arch-arrow">↓ Private routing via ALB</div>
  <div class="arch-row">
    <div class="arch-zone private" style="flex:2">
      <div class="arch-zone-title">Private Subnet – ECS Fargate Microservices (AZ-a + AZ-b)</div>
      <div class="arch-services">
        <div class="arch-svc green">🐳 meter-ingestion-svc</div>
        <div class="arch-svc green">🐳 customer-api-svc</div>
        <div class="arch-svc green">🐳 alert-manager-svc</div>
        <div class="arch-svc green">🐳 report-generator-svc</div>
        <div class="arch-svc yellow">⚡ Lambda: iot-processor</div>
        <div class="arch-svc yellow">⚡ Lambda: anomaly-detect</div>
        <div class="arch-svc yellow">⚡ Lambda: bill-calculator</div>
        <div class="arch-svc orange">📬 SQS: meter-events</div>
        <div class="arch-svc orange">📣 SNS: alert-topic</div>
        <div class="arch-svc blue">🔗 API Gateway</div>
      </div>
    </div>
  </div>
  <div class="arch-arrow">↓ Encrypted data plane (KMS)</div>
  <div class="arch-row">
    <div class="arch-zone data">
      <div class="arch-zone-title">Data Layer – Multi-AZ Replicated</div>
      <div class="arch-services">
        <div class="arch-svc purple">🗄 Aurora PostgreSQL</div>
        <div class="arch-svc purple">⚡ DynamoDB</div>
        <div class="arch-svc purple">🪣 S3 Data Lake</div>
        <div class="arch-svc teal">🔍 OpenSearch</div>
        <div class="arch-svc teal">📊 CloudWatch</div>
        <div class="arch-svc teal">🔐 KMS + Secrets Mgr</div>
      </div>
    </div>
  </div>`;
}

function animOverviewStats() {
  const targets = { 'ov-services':12, 'ov-ec2':6, 'ov-tasks':18, 'ov-lambda':8, 'ov-rps':4820 };
  Object.entries(targets).forEach(([id, target]) => {
    let cur=0; const step=target/40;
    const iv=setInterval(()=>{ cur=Math.min(cur+step,target); $(id).textContent=(id==='ov-rps'?Math.round(cur).toLocaleString():Math.round(cur)); if(cur>=target)clearInterval(iv); },25);
  });
}

// ========= EC2 =========
const ec2Data = [
  { id:'i-0a1b2c3d4e5f', name:'aqua-bastion-01', type:'t3.medium', az:'ap-south-1a', state:'running', cpu:14, mem:42, ip:'13.235.101.22' },
  { id:'i-0f1e2d3c4b5a', name:'aqua-nat-gw-01', type:'t3.small', az:'ap-south-1a', state:'running', cpu:8, mem:31, ip:'13.235.88.11' },
  { id:'i-1a2b3c4d5e6f', name:'aqua-bastion-02', type:'t3.medium', az:'ap-south-1b', state:'running', cpu:11, mem:38, ip:'65.0.54.17' },
  { id:'i-2b3c4d5e6f7a', name:'aqua-jump-host', type:'t2.micro', az:'ap-south-1b', state:'running', cpu:4, mem:22, ip:'15.206.72.5' },
  { id:'i-3c4d5e6f7a8b', name:'aqua-monitor-01', type:'t3.large', az:'ap-south-1a', state:'running', cpu:61, mem:74, ip:'-' },
  { id:'i-4d5e6f7a8b9c', name:'aqua-legacy-compat', type:'t3.small', az:'ap-south-1b', state:'stopped', cpu:0, mem:0, ip:'-' },
];

function initEC2() {
  if (inited.ec2) return; inited.ec2=true;
  const tbody = $('ec2-tbody'); if (!tbody) return;
  ec2Data.forEach(r => {
    const cpuColor = r.cpu > 70 ? '#f87171' : r.cpu > 50 ? '#fbbf24' : '#4ade80';
    tbody.innerHTML += `<tr>
      <td class="mono" style="color:#4fc3f7">${r.id}</td>
      <td style="font-weight:600">${r.name}</td>
      <td class="mono">${r.type}</td>
      <td>${r.az}</td>
      <td><span class="state-badge ${r.state}">${r.state}</span></td>
      <td>
        <span style="font-size:13px;font-weight:600;color:${cpuColor}">${r.cpu}%</span>
        <div class="cpu-bar"><div class="cpu-fill" style="width:${r.cpu}%;background:${cpuColor}"></div></div>
      </td>
      <td><span style="font-size:13px;color:#94a3b8">${r.mem}%</span></td>
      <td class="mono" style="color:#4a5568">${r.ip}</td>
    </tr>`;
  });

  const ts = genTs(20);
  lineChart('ec2-cpu-chart', ts, [
    { label:'ASG Avg CPU %', data:genData(28,15), borderColor:'#FF9900', backgroundColor:'rgba(255,153,0,0.1)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
    { label:'Scale-out threshold', data:Array(20).fill(70), borderColor:'rgba(248,113,113,0.5)', borderDash:[5,5], borderWidth:1, pointRadius:0, fill:false }
  ]);
  doughnutChart('ec2-dist-chart',
    ['t3.medium','t3.small','t3.large','t2.micro'],
    [2,2,1,1], ['#FF9900','#4fc3f7','#c084fc','#4ade80']
  );
}
tabInits.ec2 = initEC2;

// ========= ECS =========
const ecsServices = [
  { name:'meter-ingestion-svc', tasks:'4/4', cpu:'34%', mem:'59%', port:8080, image:'aquasense/meter-ingestion:v2.1.4', status:'ACTIVE' },
  { name:'customer-api-svc', tasks:'3/3', cpu:'22%', mem:'44%', port:8081, image:'aquasense/customer-api:v1.9.2', status:'ACTIVE' },
  { name:'alert-manager-svc', tasks:'2/2', cpu:'18%', mem:'38%', port:8082, image:'aquasense/alert-manager:v1.4.1', status:'ACTIVE' },
  { name:'report-generator-svc', tasks:'2/2', cpu:'44%', mem:'67%', port:8083, image:'aquasense/report-gen:v1.2.8', status:'ACTIVE' },
  { name:'auth-service', tasks:'2/2', cpu:'12%', mem:'30%', port:8084, image:'aquasense/auth:v3.0.1', status:'ACTIVE' },
  { name:'notification-svc', tasks:'1/1', cpu:'9%', mem:'25%', port:8085, image:'aquasense/notif:v1.1.0', status:'ACTIVE' },
];

function initECS() {
  if (inited.ecs) return; inited.ecs=true;
  const el = $('ecs-services'); if (!el) return;
  ecsServices.forEach(s => {
    const cpuInt = parseInt(s.cpu);
    const cpuColor = cpuInt > 60 ? '#f87171' : cpuInt > 40 ? '#fbbf24' : '#4ade80';
    el.innerHTML += `<div class="svc-card">
      <div class="svc-header">
        <span class="svc-name">${s.name}</span>
        <span class="state-badge running">ACTIVE</span>
      </div>
      <div class="svc-tasks">Tasks: ${s.tasks} · Port :${s.port}</div>
      <div class="svc-metrics">
        <div class="svc-metric">
          <div class="svc-metric-label">CPU</div>
          <div class="svc-metric-val" style="color:${cpuColor}">${s.cpu}</div>
        </div>
        <div class="svc-metric">
          <div class="svc-metric-label">Memory</div>
          <div class="svc-metric-val" style="color:#4fc3f7">${s.mem}</div>
        </div>
      </div>
      <div class="svc-image">📦 ${s.image}</div>
    </div>`;
  });

  const ts = genTs(20);
  lineChart('ecs-tasks-chart', ts, [
    { label:'Total ECS Tasks', data:genData(14,3), borderColor:'#FF9900', backgroundColor:'rgba(255,153,0,0.08)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
  ]);
  doughnutChart('ecs-cpu-pie',
    ecsServices.map(s=>s.name.replace('-svc','').replace('-service','').substring(0,12)),
    ecsServices.map(s=>parseInt(s.cpu)),
    ['#FF9900','#4fc3f7','#4ade80','#c084fc','#fbbf24','#2dd4bf']
  );
}
tabInits.ecs = initECS;

// ========= LAMBDA =========
const lambdaFns = [
  { name:'iot-processor', runtime:'Python 3.12', trigger:'IoT Core', invocations:'12,840', duration:'42ms', errors:'0.02%', memory:'256MB', icon:'📡' },
  { name:'anomaly-detector', runtime:'Python 3.12', trigger:'Kinesis', invocations:'4,200', duration:'310ms', errors:'0.00%', memory:'512MB', icon:'🔍' },
  { name:'bill-calculator', runtime:'Node.js 20.x', trigger:'Schedule', invocations:'30', duration:'820ms', errors:'0.00%', memory:'128MB', icon:'💰' },
  { name:'alert-dispatcher', runtime:'Python 3.12', trigger:'SQS', invocations:'980', duration:'88ms', errors:'0.05%', memory:'128MB', icon:'🔔' },
  { name:'data-archiver', runtime:'Python 3.12', trigger:'Schedule', invocations:'24', duration:'1.4s', errors:'0.00%', memory:'256MB', icon:'🗄' },
  { name:'report-builder', runtime:'Node.js 20.x', trigger:'API Gateway', invocations:'540', duration:'620ms', errors:'0.18%', memory:'512MB', icon:'📊' },
  { name:'firmware-updater', runtime:'Go 1.21', trigger:'SNS', invocations:'12', duration:'95ms', errors:'0.00%', memory:'128MB', icon:'🔄' },
  { name:'health-checker', runtime:'Python 3.12', trigger:'Schedule', invocations:'1,440', duration:'18ms', errors:'0.00%', memory:'128MB', icon:'❤️' },
];

function initLambda() {
  if (inited.lambda) return; inited.lambda=true;
  const el = $('lambda-grid'); if (!el) return;
  lambdaFns.forEach(fn => {
    const errColor = parseFloat(fn.errors) > 0.1 ? '#f87171' : '#4ade80';
    el.innerHTML += `<div class="lambda-card">
      <div class="fn-icon">${fn.icon}</div>
      <div class="fn-name">${fn.name}</div>
      <div class="fn-runtime">${fn.runtime} · ${fn.memory}</div>
      <div class="fn-trigger">⚡ ${fn.trigger}</div>
      <div class="fn-stats">
        <div class="fn-stat"><span class="fn-stat-label">Invocations</span><span class="fn-stat-val" style="color:#FF9900">${fn.invocations}</span></div>
        <div class="fn-stat"><span class="fn-stat-label">Avg Duration</span><span class="fn-stat-val" style="color:#4fc3f7">${fn.duration}</span></div>
        <div class="fn-stat"><span class="fn-stat-label">Error Rate</span><span class="fn-stat-val" style="color:${errColor}">${fn.errors}</span></div>
      </div>
    </div>`;
  });

  const ts = genTs(20);
  lineChart('lambda-inv-chart', ts, [
    { label:'iot-processor', data:genData(640,80), borderColor:'#FF9900', tension:0.4, borderWidth:2, pointRadius:0, fill:false },
    { label:'anomaly-detector', data:genData(210,40), borderColor:'#4fc3f7', tension:0.4, borderWidth:2, pointRadius:0, fill:false },
    { label:'alert-dispatcher', data:genData(48,12), borderColor:'#c084fc', tension:0.4, borderWidth:2, pointRadius:0, fill:false },
  ]);
  barChart('lambda-err-chart', lambdaFns.map(f=>f.name.substring(0,10)), [{
    label:'Error %',
    data: lambdaFns.map(f=>parseFloat(f.errors)),
    backgroundColor: lambdaFns.map(f=>parseFloat(f.errors)>0.1?'rgba(248,113,113,0.7)':'rgba(74,222,128,0.5)'),
    borderColor: lambdaFns.map(f=>parseFloat(f.errors)>0.1?'#f87171':'#4ade80'),
    borderWidth:1, borderRadius:4
  }]);
}
tabInits.lambda = initLambda;

// ========= MESSAGING =========
const msgData = [
  { type:'sqs', name:'aqua-meter-events-queue', arn:'arn:aws:sqs:ap-south-1:123456789:aqua-meter-events', msgs:'1,240', in:'8,400/min', consumers:'4 (Lambda)', dlq:'aqua-meter-events-dlq' },
  { type:'sqs', name:'aqua-alert-queue', arn:'arn:aws:sqs:ap-south-1:123456789:aqua-alert', msgs:'28', in:'980/min', consumers:'2 (Lambda)', dlq:'aqua-alert-dlq' },
  { type:'sns', name:'aqua-alert-topic', arn:'arn:aws:sns:ap-south-1:123456789:aqua-alert-topic', subs:'3 (Email, SMS, SQS)', msgs:'980', in:'Event-driven', dlq:'N/A' },
  { type:'sns', name:'aqua-iot-fanout', arn:'arn:aws:sns:ap-south-1:123456789:aqua-iot-fanout', subs:'2 (SQS, Kinesis)', msgs:'12,840', in:'Real-time', dlq:'N/A' },
];

function initMessaging() {
  if (inited.messaging) return; inited.messaging=true;
  const el = $('msg-grid'); if (!el) return;
  msgData.forEach(m => {
    el.innerHTML += `<div class="msg-card">
      <div class="msg-header">
        <div>
          <div class="msg-name">${m.name}</div>
          <div class="msg-arn">${m.arn}</div>
        </div>
        <span class="msg-type-badge ${m.type}">${m.type.toUpperCase()}</span>
      </div>
      <div class="msg-stats">
        <div class="msg-stat"><div class="msg-stat-label">Messages</div><div class="msg-stat-val" style="color:#FF9900">${m.msgs}</div></div>
        <div class="msg-stat"><div class="msg-stat-label">Throughput</div><div class="msg-stat-val" style="color:#4fc3f7;font-size:13px">${m.in}</div></div>
        <div class="msg-stat"><div class="msg-stat-label">${m.type==='sqs'?'DLQ':'Subscribers'}</div><div class="msg-stat-val" style="color:#94a3b8;font-size:12px">${m.type==='sqs'?m.dlq:m.subs}</div></div>
      </div>
    </div>`;
  });
}
tabInits.messaging = initMessaging;

// ========= STORAGE =========
const storeData = [
  { icon:'🗄', name:'aqua-aurora-cluster', type:'Aurora PostgreSQL 15 – Multi-AZ', stats:[
    ['Status','Available ✅'],['Engine','PostgreSQL 15.4'],['Storage','420 GB / 1TB'],['Connections','84 / 1000'],['Read Replicas','2'],['Backup','7 days'],['Encryption','AES-256 (KMS)']
  ]},
  { icon:'⚡', name:'aqua-dynamodb-meters', type:'DynamoDB – On-Demand (global tables)', stats:[
    ['Status','Active ✅'],['Table Items','30.4M'],['Read Cap','Auto'],['Write Cap','Auto'],['Avg Latency','2.1ms'],['GSI','3 indexes'],['Encryption','AWS Managed']
  ]},
  { icon:'🪣', name:'aqua-data-lake-s3', type:'S3 Data Lake – Standard + IA + Glacier', stats:[
    ['Status','Active ✅'],['Total Size','8.4 TB'],['Objects','42.1M'],['Versioning','Enabled'],['Lifecycle','Configured'],['Replication','Cross-region'],['Encryption','SSE-S3 / KMS']
  ]},
];

function initStorage() {
  if (inited.storage) return; inited.storage=true;
  const el = $('storage-grid'); if (!el) return;
  storeData.forEach(s => {
    const rows = s.stats.map(([l,v])=>`<div class="store-row"><span class="store-label">${l}</span><span class="store-val">${v}</span></div>`).join('');
    el.innerHTML += `<div class="store-card">
      <div class="store-icon">${s.icon}</div>
      <div class="store-name">${s.name}</div>
      <div class="store-type">${s.type}</div>
      <div class="store-stats">${rows}</div>
    </div>`;
  });
}
tabInits.storage = initStorage;

// ========= CLOUDWATCH =========
const logMessages = [
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">Lambda <span class="highlight">iot-processor</span>: received 47 sensor records from IoT Core</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">DynamoDB write: <span class="highlight">meter_id=SMT-W-0041</span> flow=2.84L pressure=2.4bar ts=${ts}</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">SQS msg sent to <span class="highlight">aqua-meter-events-queue</span> MessageId=abc12345</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-warn">WARN</span>  <span class="msg">anomaly-detector: pressure anomaly score 0.78 for zone-C (threshold 0.75)</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">SNS published alert to <span class="highlight">aqua-alert-topic</span> — Leakage risk detected</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">ECS task <span class="highlight">meter-ingestion-svc</span> health check OK (200) — latency 12ms</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">Aurora checkpoint completed — WAL segments archived to S3</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">CloudTrail: IAM role <span class="highlight">aqua-iot-role</span> assumed by Lambda iot-processor</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">S3 lifecycle: moved 1,240 objects to Glacier — storage saved 2.1GB</span>`,
  (ts) => `<span class="ts">[${ts}]</span> <span class="level-info">INFO</span>  <span class="msg">ALB target group <span class="highlight">aqua-ecs-tg</span>: 6/6 targets healthy</span>`,
];

let logIdx = 0;
function addLog() {
  const console_ = $('log-console'); if (!console_) return;
  const ts = new Date().toISOString().replace('T',' ').substring(0,19);
  const div = document.createElement('div');
  div.className = 'log-line';
  div.innerHTML = logMessages[logIdx % logMessages.length](ts);
  logIdx++;
  console_.insertBefore(div, console_.firstChild);
  if (console_.children.length > 40) console_.lastChild.remove();
}

function initMonitoring() {
  if (inited.monitoring) return; inited.monitoring=true;
  const ts = genTs(20, 2);
  lineChart('cw-alb', ts, [
    { label:'Req/s', data:genData(320,60), borderColor:'#FF9900', backgroundColor:'rgba(255,153,0,0.08)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
  ]);
  lineChart('cw-aurora', ts, [
    { label:'Connections', data:genData(84,18), borderColor:'#c084fc', backgroundColor:'rgba(192,132,252,0.08)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
  ]);
  lineChart('cw-dynamo', ts, [
    { label:'Read CU', data:genData(1200,300), borderColor:'#4fc3f7', backgroundColor:'rgba(79,195,247,0.06)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
  ]);
  lineChart('cw-s3', ts, [
    { label:'GET req/s', data:genData(48,12), borderColor:'#4ade80', backgroundColor:'rgba(74,222,128,0.08)', fill:true, tension:0.4, borderWidth:2, pointRadius:0 },
  ]);
  addLog();
  setInterval(addLog, 2200);
}
tabInits.monitoring = initMonitoring;

// ========= IAC =========
const iacContent = {
  cfn: `<span class="comment"># AquaSense CloudFormation Template (excerpt)
# Task 3 – Target AWS Architecture – COMP60010</span>

<span class="type">AWSTemplateFormatVersion</span><span class="op">:</span> <span class="str">'2010-09-09'</span>
<span class="type">Description</span><span class="op">:</span> <span class="str">AquaSense Smart Utilities – Multi-AZ VPC + ECS Fargate + Aurora</span>

<span class="type">Parameters</span><span class="op">:</span>
  <span class="prop">Environment</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">String</span>
    <span class="type">Default</span><span class="op">:</span> <span class="str">production</span>
  <span class="prop">VpcCidr</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">String</span>
    <span class="type">Default</span><span class="op">:</span> <span class="str">10.0.0.0/16</span>

<span class="type">Resources</span><span class="op">:</span>

  <span class="comment"># ---- VPC ----</span>
  <span class="prop">AquaVPC</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::EC2::VPC</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">CidrBlock</span><span class="op">:</span> <span class="op">!</span>Ref VpcCidr
      <span class="prop">EnableDnsSupport</span><span class="op">:</span> <span class="kw">true</span>
      <span class="prop">EnableDnsHostnames</span><span class="op">:</span> <span class="kw">true</span>
      <span class="prop">Tags</span><span class="op">:</span>
        <span class="op">-</span> <span class="prop">Key</span><span class="op">:</span> Name
          <span class="prop">Value</span><span class="op">:</span> aqua-production-vpc

  <span class="prop">PublicSubnetA</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::EC2::Subnet</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">VpcId</span><span class="op">:</span> <span class="op">!</span>Ref AquaVPC
      <span class="prop">CidrBlock</span><span class="op">:</span> <span class="str">10.0.1.0/24</span>
      <span class="prop">AvailabilityZone</span><span class="op">:</span> ap-south-1a
      <span class="prop">MapPublicIpOnLaunch</span><span class="op">:</span> <span class="kw">true</span>

  <span class="prop">PrivateSubnetA</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::EC2::Subnet</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">VpcId</span><span class="op">:</span> <span class="op">!</span>Ref AquaVPC
      <span class="prop">CidrBlock</span><span class="op">:</span> <span class="str">10.0.10.0/24</span>
      <span class="prop">AvailabilityZone</span><span class="op">:</span> ap-south-1a
      <span class="prop">MapPublicIpOnLaunch</span><span class="op">:</span> <span class="kw">false</span>

  <span class="comment"># ---- ECS Cluster ----</span>
  <span class="prop">AquaECSCluster</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::ECS::Cluster</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">ClusterName</span><span class="op">:</span> aqua-production-cluster
      <span class="prop">CapacityProviders</span><span class="op">:</span> [FARGATE, FARGATE_SPOT]

  <span class="comment"># ---- Meter Ingestion ECS Service ----</span>
  <span class="prop">MeterIngestionService</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::ECS::Service</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">Cluster</span><span class="op">:</span> <span class="op">!</span>Ref AquaECSCluster
      <span class="prop">TaskDefinition</span><span class="op">:</span> <span class="op">!</span>Ref MeterIngestionTaskDef
      <span class="prop">DesiredCount</span><span class="op">:</span> <span class="num">4</span>
      <span class="prop">LaunchType</span><span class="op">:</span> FARGATE
      <span class="prop">NetworkConfiguration</span><span class="op">:</span>
        <span class="prop">AwsvpcConfiguration</span><span class="op">:</span>
          <span class="prop">Subnets</span><span class="op">:</span> [<span class="op">!</span>Ref PrivateSubnetA, <span class="op">!</span>Ref PrivateSubnetB]
          <span class="prop">SecurityGroups</span><span class="op">:</span> [<span class="op">!</span>Ref ECSSecurityGroup]
          <span class="prop">AssignPublicIp</span><span class="op">:</span> DISABLED

  <span class="comment"># ---- Aurora PostgreSQL ----</span>
  <span class="prop">AuroraCluster</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::RDS::DBCluster</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">Engine</span><span class="op">:</span> aurora-postgresql
      <span class="prop">EngineVersion</span><span class="op">:</span> <span class="str">'15.4'</span>
      <span class="prop">DatabaseName</span><span class="op">:</span> aquasense_db
      <span class="prop">MasterUsername</span><span class="op">:</span> aqua_admin
      <span class="prop">MasterUserPassword</span><span class="op">:</span> <span class="op">!</span>Sub <span class="str">'{{resolve:secretsmanager:aqua/db:SecretString:password}}'</span>
      <span class="prop">StorageEncrypted</span><span class="op">:</span> <span class="kw">true</span>
      <span class="prop">KmsKeyId</span><span class="op">:</span> <span class="op">!</span>Ref AquaKMSKey
      <span class="prop">BackupRetentionPeriod</span><span class="op">:</span> <span class="num">7</span>
      <span class="prop">DeletionProtection</span><span class="op">:</span> <span class="kw">true</span>

  <span class="comment"># ---- Lambda – IoT Processor ----</span>
  <span class="prop">IoTProcessorFunction</span><span class="op">:</span>
    <span class="type">Type</span><span class="op">:</span> <span class="str">AWS::Lambda::Function</span>
    <span class="type">Properties</span><span class="op">:</span>
      <span class="prop">FunctionName</span><span class="op">:</span> aqua-iot-processor
      <span class="prop">Runtime</span><span class="op">:</span> python3.12
      <span class="prop">Handler</span><span class="op">:</span> handler.lambda_handler
      <span class="prop">MemorySize</span><span class="op">:</span> <span class="num">256</span>
      <span class="prop">Timeout</span><span class="op">:</span> <span class="num">30</span>
      <span class="prop">Environment</span><span class="op">:</span>
        <span class="prop">Variables</span><span class="op">:</span>
          <span class="prop">DYNAMODB_TABLE</span><span class="op">:</span> aqua-meter-data
          <span class="prop">SQS_URL</span><span class="op">:</span> <span class="op">!</span>Ref MeterEventsQueue
      <span class="prop">VpcConfig</span><span class="op">:</span>
        <span class="prop">SubnetIds</span><span class="op">:</span> [<span class="op">!</span>Ref PrivateSubnetA]
        <span class="prop">SecurityGroupIds</span><span class="op">:</span> [<span class="op">!</span>Ref LambdaSG]`,

  tf: `<span class="comment"># AquaSense Terraform Configuration (excerpt)
# Provider: AWS – ap-south-1 (Mumbai)</span>

<span class="kw">terraform</span> {
  <span class="kw">required_providers</span> {
    <span class="prop">aws</span> = {
      <span class="prop">source</span>  = <span class="str">"hashicorp/aws"</span>
      <span class="prop">version</span> = <span class="str">"~> 5.0"</span>
    }
  }
  <span class="prop">backend</span> <span class="str">"s3"</span> {
    <span class="prop">bucket</span>  = <span class="str">"aqua-terraform-state"</span>
    <span class="prop">key</span>     = <span class="str">"production/terraform.tfstate"</span>
    <span class="prop">region</span>  = <span class="str">"ap-south-1"</span>
    <span class="prop">encrypt</span> = <span class="kw">true</span>
  }
}

<span class="kw">provider</span> <span class="str">"aws"</span> {
  <span class="prop">region</span> = <span class="str">"ap-south-1"</span>
}

<span class="comment"># ---- VPC ----</span>
<span class="kw">module</span> <span class="str">"vpc"</span> {
  <span class="prop">source</span>  = <span class="str">"terraform-aws-modules/vpc/aws"</span>
  <span class="prop">version</span> = <span class="str">"5.1.2"</span>

  <span class="prop">name</span> = <span class="str">"aqua-production-vpc"</span>
  <span class="prop">cidr</span> = <span class="str">"10.0.0.0/16"</span>

  <span class="prop">azs</span>             = [<span class="str">"ap-south-1a"</span>, <span class="str">"ap-south-1b"</span>]
  <span class="prop">public_subnets</span>  = [<span class="str">"10.0.1.0/24"</span>, <span class="str">"10.0.2.0/24"</span>]
  <span class="prop">private_subnets</span> = [<span class="str">"10.0.10.0/24"</span>, <span class="str">"10.0.11.0/24"</span>]

  <span class="prop">enable_nat_gateway</span>   = <span class="kw">true</span>
  <span class="prop">single_nat_gateway</span>   = <span class="kw">false</span>
  <span class="prop">enable_dns_hostnames</span> = <span class="kw">true</span>
}

<span class="comment"># ---- ECS Cluster ----</span>
<span class="kw">resource</span> <span class="str">"aws_ecs_cluster"</span> <span class="str">"aqua"</span> {
  <span class="prop">name</span> = <span class="str">"aqua-production-cluster"</span>
  <span class="kw">setting</span> {
    <span class="prop">name</span>  = <span class="str">"containerInsights"</span>
    <span class="prop">value</span> = <span class="str">"enabled"</span>
  }
}

<span class="comment"># ---- ECS Fargate Service ----</span>
<span class="kw">resource</span> <span class="str">"aws_ecs_service"</span> <span class="str">"meter_ingestion"</span> {
  <span class="prop">name</span>            = <span class="str">"meter-ingestion-svc"</span>
  <span class="prop">cluster</span>         = aws_ecs_cluster.aqua.id
  <span class="prop">task_definition</span> = aws_ecs_task_definition.meter_ingestion.arn
  <span class="prop">desired_count</span>   = <span class="num">4</span>
  <span class="prop">launch_type</span>     = <span class="str">"FARGATE"</span>

  <span class="kw">network_configuration</span> {
    <span class="prop">subnets</span>          = module.vpc.private_subnets
    <span class="prop">security_groups</span>  = [aws_security_group.ecs_sg.id]
    <span class="prop">assign_public_ip</span> = <span class="kw">false</span>
  }

  <span class="kw">load_balancer</span> {
    <span class="prop">target_group_arn</span> = aws_lb_target_group.meter_tg.arn
    <span class="prop">container_name</span>   = <span class="str">"meter-ingestion"</span>
    <span class="prop">container_port</span>   = <span class="num">8080</span>
  }
}

<span class="comment"># ---- Lambda Function ----</span>
<span class="kw">resource</span> <span class="str">"aws_lambda_function"</span> <span class="str">"iot_processor"</span> {
  <span class="prop">function_name</span> = <span class="str">"aqua-iot-processor"</span>
  <span class="prop">runtime</span>       = <span class="str">"python3.12"</span>
  <span class="prop">handler</span>       = <span class="str">"handler.lambda_handler"</span>
  <span class="prop">memory_size</span>   = <span class="num">256</span>
  <span class="prop">timeout</span>       = <span class="num">30</span>
  <span class="prop">role</span>          = aws_iam_role.lambda_role.arn
  <span class="prop">filename</span>      = <span class="str">"functions/iot_processor.zip"</span>

  <span class="kw">vpc_config</span> {
    <span class="prop">subnet_ids</span>         = module.vpc.private_subnets
    <span class="prop">security_group_ids</span> = [aws_security_group.lambda_sg.id]
  }

  <span class="kw">environment</span> {
    <span class="prop">variables</span> = {
      <span class="prop">DYNAMODB_TABLE</span> = <span class="str">"aqua-meter-data"</span>
      <span class="prop">SQS_URL</span>        = aws_sqs_queue.meter_events.url
    }
  }
}

<span class="comment"># ---- Aurora PostgreSQL ----</span>
<span class="kw">resource</span> <span class="str">"aws_rds_cluster"</span> <span class="str">"aurora"</span> {
  <span class="prop">cluster_identifier</span>      = <span class="str">"aqua-aurora-cluster"</span>
  <span class="prop">engine</span>                  = <span class="str">"aurora-postgresql"</span>
  <span class="prop">engine_version</span>          = <span class="str">"15.4"</span>
  <span class="prop">database_name</span>           = <span class="str">"aquasense_db"</span>
  <span class="prop">master_username</span>         = <span class="str">"aqua_admin"</span>
  <span class="prop">master_password</span>         = <span class="kw">var</span>.db_password
  <span class="prop">storage_encrypted</span>       = <span class="kw">true</span>
  <span class="prop">kms_key_id</span>              = aws_kms_key.aqua.arn
  <span class="prop">deletion_protection</span>     = <span class="kw">true</span>
  <span class="prop">backup_retention_period</span> = <span class="num">7</span>
  <span class="prop">skip_final_snapshot</span>     = <span class="kw">false</span>
}`,

  cli: `<span class="comment"># AquaSense AWS CLI Deployment Commands
# Region: ap-south-1 | Account: 123456789012</span>

<span class="comment"># 1. Create VPC</span>
aws ec2 create-vpc <span class="op">\\</span>
  --cidr-block 10.0.0.0/16 <span class="op">\\</span>
  --region ap-south-1 <span class="op">\\</span>
  --tag-specifications <span class="str">'ResourceType=vpc,Tags=[{Key=Name,Value=aqua-production-vpc}]'</span>

<span class="comment"># 2. Create ECS Cluster</span>
aws ecs create-cluster <span class="op">\\</span>
  --cluster-name aqua-production-cluster <span class="op">\\</span>
  --capacity-providers FARGATE FARGATE_SPOT <span class="op">\\</span>
  --settings name=containerInsights,value=enabled <span class="op">\\</span>
  --region ap-south-1

<span class="comment"># 3. Deploy ECS Service (meter-ingestion-svc)</span>
aws ecs create-service <span class="op">\\</span>
  --cluster aqua-production-cluster <span class="op">\\</span>
  --service-name meter-ingestion-svc <span class="op">\\</span>
  --task-definition aqua-meter-ingestion:5 <span class="op">\\</span>
  --desired-count 4 <span class="op">\\</span>
  --launch-type FARGATE <span class="op">\\</span>
  --network-configuration <span class="str">"awsvpcConfiguration={subnets=[subnet-111,subnet-222],securityGroups=[sg-abc],assignPublicIp=DISABLED}"</span>

<span class="comment"># 4. Create DynamoDB Table</span>
aws dynamodb create-table <span class="op">\\</span>
  --table-name aqua-meter-data <span class="op">\\</span>
  --attribute-definitions AttributeName=meter_id,AttributeType=S AttributeName=timestamp,AttributeType=N <span class="op">\\</span>
  --key-schema AttributeName=meter_id,KeyType=HASH AttributeName=timestamp,KeyType=RANGE <span class="op">\\</span>
  --billing-mode PAY_PER_REQUEST <span class="op">\\</span>
  --sse-specification Enabled=true,SSEType=KMS <span class="op">\\</span>
  --region ap-south-1

<span class="comment"># 5. Deploy Lambda Function</span>
aws lambda create-function <span class="op">\\</span>
  --function-name aqua-iot-processor <span class="op">\\</span>
  --runtime python3.12 <span class="op">\\</span>
  --handler handler.lambda_handler <span class="op">\\</span>
  --memory-size 256 <span class="op">\\</span>
  --timeout 30 <span class="op">\\</span>
  --role arn:aws:iam::123456789012:role/aqua-lambda-role <span class="op">\\</span>
  --zip-file fileb://iot_processor.zip <span class="op">\\</span>
  --vpc-config SubnetIds=subnet-111,SecurityGroupIds=sg-lambda

<span class="comment"># 6. Create SQS Queue</span>
aws sqs create-queue <span class="op">\\</span>
  --queue-name aqua-meter-events-queue <span class="op">\\</span>
  --attributes VisibilityTimeout=60,MessageRetentionPeriod=86400

<span class="comment"># 7. Create SNS Topic</span>
aws sns create-topic <span class="op">\\</span>
  --name aqua-alert-topic <span class="op">\\</span>
  --attributes DisplayName=AquaSenseAlerts

<span class="comment"># 8. Create Aurora Cluster</span>
aws rds create-db-cluster <span class="op">\\</span>
  --db-cluster-identifier aqua-aurora-cluster <span class="op">\\</span>
  --engine aurora-postgresql <span class="op">\\</span>
  --engine-version 15.4 <span class="op">\\</span>
  --master-username aqua_admin <span class="op">\\</span>
  --manage-master-user-password <span class="op">\\</span>
  --storage-encrypted <span class="op">\\</span>
  --backup-retention-period 7 <span class="op">\\</span>
  --deletion-protection <span class="op">\\</span>
  --region ap-south-1

<span class="comment"># 9. IoT Device Simulation (Python)</span>
<span class="comment"># python3 iot_simulator.py --meters 100 --interval 5 --endpoint xxx.iot.ap-south-1.amazonaws.com</span>

<span class="comment"># 10. Validate ALB Health</span>
aws elbv2 describe-target-health <span class="op">\\</span>
  --target-group-arn arn:aws:elasticloadbalancing:ap-south-1:123456789012:targetgroup/aqua-ecs-tg/abc123`
};

function showIac(type, btn) {
  document.querySelectorAll('.iac-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  $('iac-display').innerHTML = `<pre class="code-block">${iacContent[type]}</pre>`;
}

function initIac() {
  if (inited.iac) return; inited.iac=true;
  showIac('cfn', document.querySelector('.iac-tab'));
}
tabInits.iac = initIac;

// ========= IoT CORE =========
const iotThings = [
  { id:'SMT-W-0041', type:'water',  loc:'Kitchen Block, Unit A',   status:'CONNECTED',    shadow:'Flow:2.84L, P:2.4bar' },
  { id:'SMT-W-0042', type:'water',  loc:'Garden Zone South',        status:'CONNECTED',    shadow:'Flow:0.45L, P:1.8bar' },
  { id:'SMT-E-0087', type:'energy', loc:'Distribution Board',       status:'CONNECTED',    shadow:'Power:18.4kWh' },
  { id:'SMT-W-0043', type:'water',  loc:'Factory Main Supply',      status:'SHADOW_STALE', shadow:'Flow:1.12L, P:0.9bar' },
  { id:'SMT-E-0088', type:'energy', loc:'HVAC Unit',                status:'CONNECTED',    shadow:'Power:7.2kWh' },
  { id:'SMT-W-0044', type:'water',  loc:'Backup Supply',            status:'DISCONNECTED', shadow:'—' },
];
const iotPolicies = [
  { action:'iot:Connect',   resource:`arn:aws:iot:ap-south-1:*:client/\${iot:ClientId}` },
  { action:'iot:Publish',   resource:'arn:aws:iot:ap-south-1:*:topic/smartmeter/*/usage' },
  { action:'iot:Subscribe', resource:'arn:aws:iot:ap-south-1:*:topicfilter/smartmeter/#' },
  { action:'iot:Receive',   resource:'arn:aws:iot:ap-south-1:*:topic/smartmeter/#' },
];
const iotTopics = [
  { topic:'smartmeter/water/usage',   qos:1, rate:'~40 msg/min',   desc:'Water meter telemetry — flow, pressure, quality' },
  { topic:'smartmeter/energy/usage',  qos:1, rate:'~40 msg/min',   desc:'Energy meter telemetry — power, frequency' },
  { topic:'smartmeter/water/leakage', qos:1, rate:'~10 msg/min',   desc:'Leakage sensor delta values' },
  { topic:'smartmeter/alerts/#',      qos:0, rate:'Event-driven',  desc:'Alert publications and OTA firmware commands' },
];
const iotRules = [
  { name:'MeterDataToDynamo', sql:"SELECT * FROM 'smartmeter/+/usage'",                                     actions:['DynamoDB (aqua-meter-data)','SQS (aqua-meter-events)'], enabled:true },
  { name:'AnomalyToLambda',  sql:"SELECT * FROM 'smartmeter/+/usage' WHERE value > 20",                   actions:['Lambda (anomaly-detector)'],                          enabled:true },
  { name:'LeakageAlert',     sql:"SELECT * FROM 'smartmeter/water/leakage' WHERE value > 0.5",            actions:['SNS (asu-alerts)','Lambda (alert-dispatcher)'],        enabled:true },
  { name:'ArchiveAll',       sql:"SELECT *, topic() as _topic FROM 'smartmeter/#'",                       actions:['S3 (aqua-data-lake/raw/)'],                           enabled:true },
];

function initIoT() {
  if (inited.iot) return; inited.iot = true;

  // Things list
  const thingEl = $('things-list');
  if (thingEl) iotThings.forEach(t => {
    const stColor = t.status==='CONNECTED'?'#4ade80':t.status==='SHADOW_STALE'?'#fbbf24':'#f87171';
    thingEl.innerHTML += `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);margin-bottom:6px">
      <span style="font-size:16px">${t.type==='water'?'💧':'⚡'}</span>
      <div style="flex:1">
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#4fc3f7;font-weight:600">${t.id}</div>
        <div style="font-size:11px;color:#4a5568;margin-top:1px">${t.loc}</div>
        <div style="font-size:10px;color:#4a5568;margin-top:1px;font-family:'JetBrains Mono',monospace">${t.shadow}</div>
      </div>
      <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:6px;background:${stColor}22;color:${stColor};border:1px solid ${stColor}44">${t.status}</span>
    </div>`;
  });

  // Policy rules
  const polEl = $('policy-rules');
  if (polEl) iotPolicies.forEach(p => {
    polEl.innerHTML += `<div style="padding:10px 12px;border-radius:8px;background:rgba(255,153,0,0.05);border:1px solid rgba(255,153,0,0.1);margin-bottom:6px">
      <div style="font-size:11px;font-weight:700;color:#FF9900;margin-bottom:3px">${p.action}</div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#4a5568">${p.resource}</div>
    </div>`;
  });

  // MQTT topics
  const mqttEl = $('mqtt-topics');
  if (mqttEl) iotTopics.forEach(t => {
    mqttEl.innerHTML += `<div style="padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);margin-bottom:6px">
      <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#c084fc;font-weight:600">${t.topic}</div>
      <div style="display:flex;gap:10px;margin-top:4px">
        <span style="font-size:10px;background:rgba(255,255,255,0.06);padding:1px 7px;border-radius:4px;color:#94a3b8">QoS ${t.qos}</span>
        <span style="font-size:10px;color:#4a5568">${t.rate}</span>
      </div>
      <div style="font-size:11px;color:#4a5568;margin-top:3px">${t.desc}</div>
    </div>`;
  });

  // Rules Engine
  const rulesEl = $('iot-rules');
  if (rulesEl) iotRules.forEach(r => {
    rulesEl.innerHTML += `<div style="padding:14px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);margin-bottom:10px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:13px;font-weight:700;color:#f1f5f9">${r.name}</span>
        <span style="font-size:10px;font-weight:700;background:rgba(74,222,128,0.15);color:#4ade80;border:1px solid rgba(74,222,128,0.3);padding:2px 8px;border-radius:5px">ENABLED</span>
      </div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:#fbbf24;background:rgba(251,191,36,0.05);padding:6px 10px;border-radius:5px;margin-bottom:8px">${r.sql}</div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${r.actions.map(a=>`<span style="font-size:10px;background:rgba(255,153,0,0.1);color:#FF9900;border:1px solid rgba(255,153,0,0.2);padding:2px 8px;border-radius:5px">${a}</span>`).join('')}</div>
    </div>`;
  });

  // IoT Message Rate chart
  lineChart('iot-msg-chart', genTs(20,1), [
    { label:'Water msgs/min',  data:genData(42,8),  borderColor:'#38bdf8', tension:0.4, borderWidth:2, pointRadius:0, fill:false },
    { label:'Energy msgs/min', data:genData(38,6),  borderColor:'#fbbf24', tension:0.4, borderWidth:2, pointRadius:0, fill:false },
    { label:'Leakage msgs/min',data:genData(10,3),  borderColor:'#f87171', tension:0.4, borderWidth:1.5, pointRadius:0, fill:false },
  ]);

  // Data flow diagram
  const flowEl = $('iot-flow');
  if (flowEl) flowEl.innerHTML = `<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <div style="text-align:center;padding:10px 14px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.25);border-radius:8px;font-size:11px;font-weight:600">📡 Smart Meters<br><span style="font-size:10px;color:#4a5568;font-weight:400">30K+ IoT Things</span></div>
    <div style="color:#4a5568;font-size:18px">→</div>
    <div style="text-align:center;padding:10px 14px;background:rgba(255,153,0,0.1);border:1px solid rgba(255,153,0,0.25);border-radius:8px;font-size:11px;font-weight:600">☁️ IoT Core<br><span style="font-size:10px;color:#4a5568;font-weight:400">MQTT Broker</span></div>
    <div style="color:#4a5568;font-size:18px">→</div>
    <div style="text-align:center;padding:10px 14px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;font-size:11px;font-weight:600">⚡ Rules Engine<br><span style="font-size:10px;color:#4a5568;font-weight:400">4 Active Rules</span></div>
    <div style="color:#4a5568;font-size:18px">→</div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <div style="text-align:center;padding:8px 12px;background:rgba(192,132,252,0.08);border:1px solid rgba(192,132,252,0.2);border-radius:8px;font-size:10px;font-weight:600">⚡ DynamoDB<br><span style="color:#4a5568;font-weight:400">Raw telemetry</span></div>
      <div style="text-align:center;padding:8px 12px;background:rgba(255,153,0,0.08);border:1px solid rgba(255,153,0,0.2);border-radius:8px;font-size:10px;font-weight:600">📬 SQS Queue<br><span style="color:#4a5568;font-weight:400">meter-events</span></div>
      <div style="text-align:center;padding:8px 12px;background:rgba(74,222,128,0.08);border:1px solid rgba(74,222,128,0.2);border-radius:8px;font-size:10px;font-weight:600">🪣 S3 Data Lake<br><span style="color:#4a5568;font-weight:400">Archive</span></div>
    </div>
  </div>`;
}
tabInits.iot = initIoT;

// ========= BOOT / AUTH GUARD =========
document.addEventListener('DOMContentLoaded', async () => {
  // Wire login form
  $('admin-login-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const success = await handleAdminLogin($('admin-email').value.trim(), $('admin-password').value);
    if (success) {
      initDashboard();
    }
  });

  const loggedIn = await checkAdminAuth();
  if (loggedIn) {
    initDashboard();
  } else {
    showAdminLogin();
  }
});

function initDashboard() {
  hideAdminLogin();
  $('admin-signout-btn').style.display = 'block';
  
  // Start intervals/initialization
  tickClock();
  initOverview();
  switchTab('overview', $('tab-overview'));
}

// ========= LIVE HEALTH POLLING =========
const SVC_URLS = {
  'user-service':    'http://localhost:8081',
  'billing-service': 'http://localhost:8082',
  'usage-service':   'http://localhost:8083',
  'alert-service':   'http://localhost:8084',
};

async function pollHealth() {
  if (!ADMIN_AUTH.token) return; // Guard
  for (const [name, url] of Object.entries(SVC_URLS)) {
    try {
      const res = await fetch(url + '/api/auth/health');
      console.log(`[health] ${name}: ${res.status}`);
    } catch (e) {
      console.warn(`[health] ${name} offline`);
    }
  }
}
setInterval(pollHealth, 10000);

async function pollServiceHealth() {
  let allHealthy = true;
  for (const [name, url] of Object.entries(SVC_URLS)) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 3000);
      const res  = await fetch(`${url}/health`, { signal: ctrl.signal });
      clearTimeout(tid);
      const data = await res.json();
      const ok   = data.status === 'healthy';
      if (!ok) allHealthy = false;
      console.log(`[health] ${name}: ${ok ? '✅' : '⚠️'} (uptime ${Math.floor(data.uptime||0)}s)`);
    } catch {
      allHealthy = false;
      console.warn(`[health] ${name}: ❌ unreachable (local services may not be running)`);
    }
  }
  const pill = document.querySelector('.status-pill');
  if (pill) {
    pill.className = `status-pill ${allHealthy ? 'green' : 'orange'}`;
    pill.innerHTML = `<span class="pulse-dot"></span>${allHealthy ? 'All Services Healthy' : 'Service Degraded'}`;
  }
}
setTimeout(pollServiceHealth, 2000);
setInterval(pollServiceHealth, 30000);

// ========= BOOT =========
document.addEventListener('DOMContentLoaded', () => {
  initOverview();
});
