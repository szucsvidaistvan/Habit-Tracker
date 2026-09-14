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
    console.log('[UI.renderHabits] Renderelés indítása habitsList:', habitsList);
    const container = document.getElementById('habits-container');
    if (!container) {
      console.error('[UI.renderHabits] ERROR: #habits-container elem nem található a DOM-ban!');
      return;
    }

    if (!habitsList || habitsList.length === 0) {
      console.warn('[UI.renderHabits] Nincsenek aktív szokások.');
      container.innerHTML = '<div class="loader">Nincsenek aktív szokások.</div>';
      this.updateProgress([]);
      return;
    }

    container.innerHTML = habitsList.map(h => `
      <div class="habit-card-wrapper">
        <div class="swipe-actions">
          <button class="swipe-btn edit" onclick="console.log('[UI.click] Szerkesztés gomb megnyomva ID:', '${h.id}'); App.openEditModal('${h.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="swipe-btn delete" onclick="console.log('[UI.click] Törlés gomb megnyomva ID:', '${h.id}'); App.handleDeleteHabit('${h.id}')">
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
              <input type="checkbox" ${h.completed ? 'checked' : ''} onchange="console.log('[UI.toggle] Kapcsoló állítás ID:', '${h.id}'); App.handleToggleHabit('${h.id}')">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    `).join('');

    console.log('[UI.renderHabits] HTML sikeresen beillesztve.');
    this.updateProgress(habitsList);
    this.initSwipeEvents(habitsList);
  },

  updateProgress(habitsList) {
    const completed = habitsList.filter(h => h.completed).length;
    const total = habitsList.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
    
    console.log(`[UI.updateProgress] Teljesítve: ${completed}/${total} (${percent}%)`);

    const textElem = document.getElementById('progress-text');
    const fillElem = document.getElementById('progress-fill');

    if (textElem) textElem.innerText = `${percent}%`;
    else console.warn('[UI.updateProgress] #progress-text elem hiányzik');

    if (fillElem) fillElem.style.width = `${percent}%`;
    else console.warn('[UI.updateProgress] #progress-fill elem hiányzik');
  },

  initSwipeEvents(habitsList) {
    console.log('[UI.initSwipeEvents] Húzási események inicializálása...');
    habitsList.forEach(h => {
      const card = document.getElementById(`swipe-content-${h.id}`);
      if (!card) {
        console.error(`[UI.initSwipeEvents] Kártya nem található: #swipe-content-${h.id}`);
        return;
      }

      let startX = 0, currentX = 0, isOpen = false, isDragging = false;

      card.addEventListener('pointerdown', (e) => {
        // Ha a kapcsolóra kattint, ne indítsa el a kártya húzását
        if (e.target.closest('.switch')) {
          console.log(`[Swipe] PointerDown figyelmen kívül hagyva (Switch-re kattintott) - ID: ${h.id}`);
          return;
        }

        console.log(`[Swipe] PointerDown (Start drag) - ID: ${h.id}, PointerType: ${e.pointerType}`);
        startX = e.clientX;
        currentX = startX;
        isDragging = true;

        try {
          card.setPointerCapture(e.pointerId);
        } catch (err) {
          console.warn('[Swipe] Pointer capture sikertelen:', err);
        }

        card.style.transition = 'none';
      });

      card.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        currentX = e.clientX;
        let diffX = currentX - startX;

        if (isOpen) {
          let newX = -110 + diffX;
          if (newX > 0) newX = 0;
          if (newX < -110) newX = -110;
          card.style.transform = `translateX(${newX}px)`;
        } else if (diffX < 0 && diffX > -130) {
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
        console.log(`[Swipe] PointerUp/Cancel - ID: ${h.id}, Elmozdulás (diffX): ${diffX}px, Előtte nyitva volt: ${isOpen}`);

        if (!isOpen && diffX < -40) {
          card.style.transform = 'translateX(-110px)';
          isOpen = true;
          console.log(`[Swipe] Kártya KINYITVA -> ID: ${h.id}`);
        } else if (isOpen && diffX > 30) {
          card.style.transform = 'translateX(0px)';
          isOpen = false;
          console.log(`[Swipe] Kártya BECSUKVA -> ID: ${h.id}`);
        } else {
          card.style.transform = isOpen ? 'translateX(-110px)' : 'translateX(0px)';
        }
      };

      card.addEventListener('pointerup', handlePointerUp);
      card.addEventListener('pointercancel', handlePointerUp);
    });
  },

  renderBarChart(labels, data) {
    console.log('[UI.renderBarChart] Oszlopdiagram rajzolása...', { labels, data });
    const ctx = document.getElementById('barChart');
    if (!ctx) {
      console.warn('[UI.renderBarChart] #barChart elem nem található.');
      return;
    }
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
    console.log('[UI.renderLineChart] Vonaldiagram rajzolása...', { labels, data });
    const ctx = document.getElementById('statsChart');
    if (!ctx) {
      console.warn('[UI.renderLineChart] #statsChart elem nem található.');
      return;
    }
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
