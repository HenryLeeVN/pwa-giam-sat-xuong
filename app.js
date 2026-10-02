// === CẤU HÌNH KẾT NỐI SUPABASE ===
const SUPABASE_URL = "https://nhieidisubjhwarhowdx.supabase.co/rest/v1";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5oaWVpZGlzdWJqaHdhcmhvd2R4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA4ODM5ODksImV4cCI6MjEwNjQ1OTk4OX0.u1x9yPEX_jaIm-IUdrVtNwfvb4euEU6mbOP9AuAb3Go";

const HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json"
};

// === CẤU HÌNH DANH SÁCH MÁY (DỄ DÀNG THÊM MÁY MỚI TẠI ĐÂY) ===
const MACHINES = [
  { id: "A", name: "Máy Dập Khung A" }
  // Để mở rộng sau này, chỉ cần thêm:
  // { id: "B", name: "Máy Dập Cắt B" },
  // { id: "C", name: "Máy Uốn Ống C" },
];

const OFFLINE_THRESHOLD_SECONDS = 30; // Quá 30 giây không có tín hiệu = Mất kết nối
const POLLING_INTERVAL_MS = 5000;     // Polling mỗi 5 giây

let chartInstance = null;
let currentChartMachine = "A";

// Cache dữ liệu nội bộ
const machineDataCache = {};

// === HÀM HỖ TRỢ NGÀY GIỜ ===
function getStartOfTodayISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function formatTime(isoString) {
  if (!isoString) return "--:--:--";
  const date = new Date(isoString);
  return date.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getSecondsDiff(isoString) {
  if (!isoString) return 999999;
  const then = new Date(isoString).getTime();
  const now = Date.now();
  return Math.floor((now - then) / 1000);
}

// === GỌI API SUPABASE ===
// 1. Lấy dòng mới nhất của máy
async function fetchLatestData(machineId) {
  const url = `${SUPABASE_URL}/du_lieu_may?ma_may=eq.${machineId}&order=created_at.desc&limit=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.length > 0 ? data[0] : null;
}

// 2. Lấy số đếm đầu tiên của ngày hôm nay để tính sản lượng trong ngày
async function fetchTodayBaseData(machineId) {
  const startOfDay = getStartOfTodayISO();
  const url = `${SUPABASE_URL}/du_lieu_may?ma_may=eq.${machineId}&created_at=gte.${startOfDay}&order=created_at.asc&limit=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  return data.length > 0 ? data[0] : null;
}

// 3. Lấy dữ liệu lịch sử trong ngày để vẽ biểu đồ
async function fetchTodayHistory(machineId) {
  const startOfDay = getStartOfTodayISO();
  // Chỉ lấy created_at và tong_dem để tối ưu băng thông
  const url = `${SUPABASE_URL}/du_lieu_may?ma_may=eq.${machineId}&created_at=gte.${startOfDay}&select=created_at,tong_dem&order=created_at.asc`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return [];
  return await res.json();
}

// === CẬP NHẬT GIAO DIỆN MÀN HÌNH ===
function renderMachineCard(machine, latest, todayBase) {
  const container = document.getElementById("machines-grid");
  let card = document.getElementById(`machine-card-${machine.id}`);

  const diffSeconds = latest ? getSecondsDiff(latest.created_at) : 99999;
  const isOnline = diffSeconds <= OFFLINE_THRESHOLD_SECONDS;

  // Tính sản lượng thực tế trong ngày = tong_dem hiện tại - tong_dem đầu ngày
  let todayCount = 0;
  if (latest && todayBase) {
    todayCount = Math.max(0, latest.tong_dem - todayBase.tong_dem);
  }

  const statusClass = isOnline ? "running" : "stopped";
  const statusText = isOnline ? "● ĐANG HOẠT ĐỘNG" : "▲ MẤT KẾT NỐI / DỪNG";
  const statusTimeAgo = diffSeconds < 60 ? `${diffSeconds}s trước` : `${Math.floor(diffSeconds / 60)} phút trước`;

  const totalCount = latest ? latest.tong_dem.toLocaleString("vi-VN") : "0";
  const todayCountDisplay = todayCount.toLocaleString("vi-VN");
  const lastSyncTime = latest ? formatTime(latest.created_at) : "Chưa có dữ liệu";

  const cardHtml = `
    <div class="card-indicator-strip"></div>
    <div class="card-header">
      <div>
        <div class="machine-name">${machine.name}</div>
        <span class="machine-code-badge">MÃ: ${machine.id}</span>
      </div>
      <div class="status-badge">${statusText}</div>
    </div>

    <div class="counter-box">
      <div class="counter-label">TỔNG SẢN LƯỢNG LŨY KẾ</div>
      <div class="counter-number">${totalCount}</div>
    </div>

    <div class="sub-stats">
      <div class="sub-stat-item">
        <span class="sub-stat-label">Sản lượng hôm nay</span>
        <span class="sub-stat-val">+${todayCountDisplay} cái</span>
      </div>
      <div class="sub-stat-item">
        <span class="sub-stat-label">Nhịp gần nhất</span>
        <span class="sub-stat-val">${statusTimeAgo}</span>
      </div>
    </div>

    <div class="card-footer">
      <span>Cập nhật log: ${lastSyncTime}</span>
      <span>${isOnline ? "ESP32: Tốt" : "Kiểm tra nguồn/Wifi"}</span>
    </div>
  `;

  if (!card) {
    card = document.createElement("div");
    card.id = `machine-card-${machine.id}`;
    card.className = `machine-card ${statusClass}`;
    card.innerHTML = cardHtml;
    container.appendChild(card);
  } else {
    card.className = `machine-card ${statusClass}`;
    card.innerHTML = cardHtml;
  }
}

// === VẼ VÀ CẬP NHẬT BIỂU ĐỒ (CHART.JS) ===
function initChart() {
  const ctx = document.getElementById("outputChart").getContext("2d");
  chartInstance = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [{
        label: "Tổng sản phẩm (Cái)",
        data: [],
        borderColor: "#06b6d4",
        backgroundColor: "rgba(6, 182, 212, 0.12)",
        fill: true,
        tension: 0.25,
        borderWidth: 2.5,
        pointRadius: 2,
        pointHoverRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#94a3b8", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.06)" },
          ticks: { color: "#94a3b8" }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#1e293b",
          titleColor: "#f8fafc",
          bodyColor: "#38bdf8",
          borderColor: "#334155",
          borderWidth: 1,
          padding: 10
        }
      }
    }
  });
}

// Lọc bớt các điểm heartbeat không đổi sản lượng để biểu đồ nhẹ và mượt
function downsampleHistory(rawPoints, maxPoints = 50) {
  if (rawPoints.length <= maxPoints) return rawPoints;
  const filtered = [];
  let lastCount = -1;

  for (let i = 0; i < rawPoints.length; i++) {
    const pt = rawPoints[i];
    // Giữ điểm nếu sản lượng tăng, hoặc là điểm đầu/cuối
    if (pt.tong_dem !== lastCount || i === 0 || i === rawPoints.length - 1) {
      filtered.push(pt);
      lastCount = pt.tong_dem;
    }
  }

  // Nếu vẫn còn quá nhiều điểm, lấy mẫu theo bước nhảy đều
  if (filtered.length > maxPoints) {
    const step = Math.ceil(filtered.length / maxPoints);
    return filtered.filter((_, idx) => idx % step === 0 || idx === filtered.length - 1);
  }
  return filtered;
}

async function updateChart(machineId) {
  try {
    const history = await fetchTodayHistory(machineId);
    if (!chartInstance) return;

    if (history.length === 0) {
      chartInstance.data.labels = ["Chưa có dữ liệu"];
      chartInstance.data.datasets[0].data = [0];
      chartInstance.update();
      return;
    }

    const sampled = downsampleHistory(history, 60);
    const labels = sampled.map(item => formatTime(item.created_at));
    const data = sampled.map(item => item.tong_dem);

    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.update("none"); // update mượt không cần giật lag
  } catch (err) {
    console.warn("Lỗi cập nhật biểu đồ:", err);
  }
}

// === VÒNG LẶP CHÍNH (POLLING) ===
async function syncAllData() {
  let anyError = false;

  for (const machine of MACHINES) {
    try {
      const [latest, todayBase] = await Promise.all([
        fetchLatestData(machine.id),
        fetchTodayBaseData(machine.id)
      ]);

      machineDataCache[machine.id] = { latest, todayBase };
      renderMachineCard(machine, latest, todayBase);
    } catch (err) {
      console.error(`Lỗi cập nhật máy ${machine.id}:`, err);
      anyError = true;
    }
  }

  // Cập nhật biểu đồ cho máy đang chọn
  await updateChart(currentChartMachine);

  // Cập nhật trạng thái kết nối chung
  const statusPill = document.getElementById("connection-status-pill");
  const statusText = document.getElementById("connection-status-text");
  const lastSyncLabel = document.getElementById("last-global-sync");

  if (anyError && !navigator.onLine) {
    statusPill.className = "pill pill-disconnected";
    statusText.textContent = "Offline (Mất mạng)";
  } else {
    statusPill.className = "pill pill-connected";
    statusText.textContent = "Hệ thống Online";
  }

  lastSyncLabel.textContent = `Cập nhật: ${new Date().toLocaleTimeString("vi-VN")}`;
}

// === KHỞI CHẠY ỨNG DỤNG ===
document.addEventListener("DOMContentLoaded", () => {
  // Điền dropdown chọn máy cho chart
  const select = document.getElementById("machine-select");
  MACHINES.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.name} (${m.id})`;
    select.appendChild(opt);
  });

  select.addEventListener("change", (e) => {
    currentChartMachine = e.target.value;
    updateChart(currentChartMachine);
  });

  document.getElementById("btn-refresh").addEventListener("click", () => {
    syncAllData();
  });

  initChart();
  syncAllData();

  // Bắt đầu chu kỳ polling tự động
  setInterval(syncAllData, POLLING_INTERVAL_MS);

  // Đăng ký Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .then(() => console.log("Service Worker đã sẵn sàng."))
      .catch(err => console.log("SW lỗi:", err));
  }
});