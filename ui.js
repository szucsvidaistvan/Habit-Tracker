let lineChartInstance = null;
let barChartInstance = null;

const UI = {
  getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  renderHabits(habitsList) {
    const container = document.getElementById('habits-container');
    if (!container) return;

    if (habitsList.length === 0) {
      container.innerHTML = '<div class="loader">Nincsenek aktív szokások.</div>';
      this.updateProgress(habitsList);
      return;
    }

    container.innerHTML = habitsList.map(h => `
      <div class="habit-card-wrapper">
        <div class="swipe-actions">
          <button class="swipe-btn edit" onclick="App.openEditModal('${h.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="swipe-btn delete" onclick="App.handleDeleteHabit('${h.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
        <div class="habit-item" id="swipe-content-${h.id}">
          <div class="habit-info">
            <span class="habit-name">${h.title}</span>
            <span class="habit-time">${h.weekly_target ? 'Cél: Heti ' + h.weekly_target + 'x' : ''}</span>
          </div>
          <div id="switch-wrapper-${h.id}">
            <label class="switch">
              <input type="checkbox" ${h.completed ? 'checked' : ''} onchange="App.handleToggleHabit('${h.id}')">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    `).join('');

    this.updateProgress(habitsList);
    this.initSwipeEvents(habitsList);
  },

  updateProgress(habitsList) {
    const completed = habitsList.filter(h => h.completed).length;
    const total = habitsList.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    document.getElementById('progress-text').innerText = `${percent}%`;
    document.getElementById('progress-fill').style.width = `${percent}%`;
  },

  initSwipeEvents(habitsList) {
    habitsList.forEach(h => {
      const card = document.getElementById(`swipe-content-${h.id}`);
      const switchElem = document.getElementById(`switch-wrapper-${h.id}`);
      if (!card) return;

      if (switchElem) {
        ['touchstart', 'touchmove', 'touchend'].forEach(evtType => {
          switchElem.addEventListener(evtType, (e) => e.stopPropagation(), { passive: true });
        });
      }

      let startX = 0, currentX = 0, isOpen = false;

      card.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        currentX = startX;
        card.style.transition = 'none';
      }, { passive: true });

      card.addEventListener('touchmove', (e) => {
        currentX = e.touches[0].clientX;
        let diffX = currentX - startX;
        if (isOpen) {
          let newX = -110 + diffX;
          if (newX > 0) newX = 0;
          if (newX < -110) newX = -110;
          card.style.transform = `translateX(${newX}px)`;
        } else if (diffX < 0 && diffX > -130) {
          card.style.transform = `translateX(${diffX}px)`;
        }
      }, { passive: true });

      card.addEventListener('touchend', () => {
        card.style.transition = 'transform 0.2s ease-out';
        const diffX = currentX - startX;
        if (!isOpen && diffX < -50) {
          card.style.transform = 'translateX(-110px)';
          isOpen = true;
        } else if (isOpen && diffX > 30) {
          card.style.transform = 'translateX(0px)';
          isOpen = false;
        } else {
          card.style.transform = isOpen ? 'translateX(-110px)' : 'translateX(0px)';
        }
      });
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
  }
};