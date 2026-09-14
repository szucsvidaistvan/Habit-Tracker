// User Interface (UI) rendering and event-handling layer
let lineChartInstance = null;
let barChartInstance = null;

const UI = {
  getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  formatMinutes(mins) {
    if (!mins || mins === 0) return 'Unlimited';
    if (mins >= 60 && mins % 60 === 0) {
      const hours = mins / 60;
      return `${hours} hr`;
    }
    return `${mins} min`;
  },

  renderHabits(habitsList) {
    console.log('[UI.renderHabits] Starting render with habitsList:', habitsList);
    const container = document.getElementById('habits-container');
    if (!container) return;

    if (!habitsList || habitsList.length === 0) {
      console.warn('[UI.renderHabits] No active habits.');
      container.innerHTML = '<div class="loader">No active habits.</div>';
      this.updateProgress([]);
      return;
    }

    container.innerHTML = habitsList.map(h => {
      const targetText = h.weekly_target ? `${h.weekly_target}x/week` : '';
      const timeText = this.formatMinutes(h.target_minutes);
      const subInfo = [targetText, timeText].filter(Boolean).join(' • ');

      return `
        <div class="habit-card-wrapper">
          <div class="swipe-actions">
            <button class="swipe-btn edit" onclick="console.log('[UI.click] Edit ID:', '${h.id}'); App.openEditModal('${h.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="swipe-btn delete" onclick="console.log('[UI.click] Delete ID:', '${h.id}'); App.handleDeleteHabit('${h.id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
          <div class="habit-item" id="swipe-content-${h.id}">
            <div class="habit-info">
              <span class="habit-name">${h.title}</span>
              <span class="habit-time">${subInfo}</span>
            </div>
            <div id="switch-wrapper-${h.id}">
              <label class="switch">
                <input type="checkbox" ${h.completed ? 'checked' : ''} onchange="console.log('[UI.toggle] Toggle ID:', '${h.id}'); App.handleToggleHabit('${h.id}')">
                <span class="slider"></span>
              </label>
            </div>
          </div>
        </div>
      `;
    }).join('');

    console.log('[UI.renderHabits] HTML successfully updated.');
    this.updateProgress(habitsList);
    this.initSwipeEvents(habitsList);
  },

  updateProgress(habitsList) {
    const completed = habitsList.filter(h => h.completed).length;
    const total = habitsList.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

    const textElem = document.getElementById('progress-text');
    const fillElem = document.getElementById('progress-fill');

    if (textElem) textElem.innerText = `${percent}%`;
    if (fillElem) fillElem.style.width = `${percent}%`;
  },

  initSwipeEvents(habitsList) {
    console.log('[UI.initSwipeEvents] Attaching swipe event listeners...');
    habitsList.forEach(h => {
      const card = document.getElementById(`swipe-content-${h.id}`);
      if (!card) return;

      let startX = 0, currentX = 0, isOpen = false, isDragging = false;

      card.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.switch')) return;

        startX = e.clientX;
        currentX = startX;
        isDragging = true;

        try {
          card.setPointerCapture(e.pointerId);
        } catch (_) {}

        card.style.transition = 'none';
      });

      card.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        currentX = e.clientX;
        let diffX = currentX - startX;

        if (isOpen) {
          let newX = -128 + diffX;
          if (newX > 0) newX = 0;
          if (newX < -128) newX = -128;
          card.style.transform = `translateX(${newX}px)`;
        } else if (diffX < 0 && diffX > -148) {
          card.style.transform = `translateX(${diffX}px)`;
        }
      });

      const handlePointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;

        try {
          card.releasePointerCapture(e.pointerId);
        } catch (_) {}

        card.style.transition = 'transform 0.2s ease-out';
        const diffX = currentX - startX;

        if (!isOpen && diffX < -40) {
          card.style.transform = 'translateX(-128px)';
          isOpen = true;
        } else if (isOpen && diffX > 30) {
          card.style.transform = 'translateX(0px)';
          isOpen = false;
        } else {
          card.style.transform = isOpen ? 'translateX(-128px)' : 'translateX(0px)';
        }
      };

      card.addEventListener('pointerup', handlePointerUp);
      card.addEventListener('pointercancel', handlePointerUp);
    });
  },

  renderBarChart(labels, data) {
    const ctx = document.getElementById('barChart');
    if (!ctx) return;
    if (barChartInstance) barChartInstance.destroy();

    barChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{ data: data, backgroundColor: '#00e676', borderRadius: 6 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  },

  renderLineChart(labels, data) {
    const ctx = document.getElementById('statsChart');
    if (!ctx) return;
    if (lineChartInstance) lineChartInstance.destroy();

    lineChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{ data: data, borderColor: '#00e676', backgroundColor: 'rgba(0, 230, 118, 0.15)', borderWidth: 2.5, fill: true, tension: 0.3 }]
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
    });
  },

  renderHabitStats(list) {
    console.log('[UI.renderHabitStats] Rendering per-habit completion list:', list);
    const container = document.getElementById('habit-stats-container');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="loader">No habits yet.</div>';
      return;
    }

    container.innerHTML = list.map(h => `
      <div class="habit-stat-row">
        <span class="habit-stat-name">${h.title}</span>
        <span class="habit-stat-percent">${h.percent}%</span>
        <div class="habit-stat-bar-bg">
          <div class="habit-stat-bar-fill" style="width: ${h.percent}%;"></div>
        </div>
      </div>
    `).join('');
  },

  renderInactiveHabits(list) {
    console.log('[UI.renderInactiveHabits] Rendering inactive habits list:', list);
    const container = document.getElementById('inactive-habits-list-container');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="loader">No inactive habits.</div>';
      return;
    }

    container.innerHTML = list.map(h => `
      <div class="inactive-habit-row">
        <span class="inactive-habit-name">${h.title}</span>
        <button class="btn-primary btn-sm" onclick="console.log('[UI.click] Reactivate ID:', '${h.id}'); App.reactivateFromProfile('${h.id}')">Reactivate</button>
      </div>
    `).join('');
  }
};
