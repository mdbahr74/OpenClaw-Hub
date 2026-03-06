document.addEventListener("DOMContentLoaded", () => {
  console.log("Module loaded:", document.title);

  // Create stats container
  const statsDiv = document.createElement("div");
  statsDiv.id = "sys-stats";
  statsDiv.textContent = "CPU: --% | MEM: --";
  document.body.appendChild(statsDiv);

  function flashWarning() {
    statsDiv.style.backgroundColor = "rgba(255,0,0,0.2)";
    setTimeout(() => {
      statsDiv.style.backgroundColor = "rgba(0,0,0,0.4)";
    }, 800);
  }

  function updateSystemStats() {
    if (!window.systemStats) return;

    const cpu = window.systemStats.getCpu();
    const mem = window.systemStats.getMemory();
    const memPercent = Math.round((mem.used / mem.total) * 100);

    // CPU color
    let cpuColor = "lightgreen";
    if (cpu > 80) cpuColor = "red";
    else if (cpu > 40) cpuColor = "yellow";

    // MEM color
    let memColor = "lightgreen";
    if (memPercent > 85) memColor = "red";
    else if (memPercent > 60) memColor = "yellow";

    statsDiv.innerHTML = `
      <span style="color:${cpuColor};">CPU: ${cpu}%</span> |
      <span style="color:${memColor};">MEM: ${mem.used}/${mem.total} MB</span>
    `;

    if (cpu > 90 || memPercent > 90) {
      flashWarning();
    }
  }

  setInterval(updateSystemStats, 2000);
});
