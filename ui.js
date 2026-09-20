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

  getBandInfo(percent) {
    if (percent < 30) return { color: 'var(--band-red)', glow: 'var(--band-red-glow)' };
    if (percent < 55) return { color: 'var(--band-orange)', glow: 'var(--band-orange-glow)' };
    if (percent < 75) return { color: 'var(--band-yellow)', glow: 'var(--band-yellow-glow)' };
    return { color: 'var(--band-green)', glow: 'var(--band-green-glow)' };
  },

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  renderCategorySelect(categories, selectedCategoryId = null) {
    const select = document.getElementById('habit-category-input');
    if (!select) return;

    const options = (categories || []).map(category => `
      <option value="${category.id}" ${String(category.id) === String(selectedCategoryId) ? 'selected' : ''}>
        ${this.escapeHtml(category.name)}
      </option>
    `).join('');

    select.innerHTML = options;
  },

  renderCategories(categories) {
    const container = document.getElementById('categories-list');
    if (!container) return;

    container.innerHTML = (categories || []).map(category => `
      <div class="category-management-row">
        <span>${this.escapeHtml(category.name)}</span>

        <div class="category-management-actions">
          <button class="btn-secondary btn-sm" onclick="App.renameCategory('${category.id}')">
            Rename
          </button>

          <button class="btn-danger btn-sm" onclick="App.removeCategory('${category.id}')">
            Delete
          </button>
        </div>
      </div>
    `).join('');
  },

  renderHabits(habitsList, categories = []) {
    console.log('[UI.renderHabits] Starting render with habitsList:', habitsList);
    const container = document.getElementById('habits-container');
    if (!container) return;

    if (!habitsList || habitsList.length === 0) {
      console.warn('[UI.renderHabits] No active habits.');
      container.innerHTML = '<div class="loader">No active habits.</div>';
      this.updateProgress([]);
      return;
    }

    const categoriesById = new Map((categories || []).map(cat => [String(cat.id), cat]));

    const groups = (categories || []).map(category => ({
      id: category.id,
      name: category.name,
      habits: habitsList
        .filter(h => String(h.category_id || '') === String(category.id))
        .sort((a, b) => (a.position || 0) - (b.position || 0))
    }));

    const uncategorized = habitsList.filter(h => !categoriesById.has(String(h.category_id || '')));
    if (uncategorized.length > 0) {
      groups.push({
        id: 'uncategorized',
        name: 'Other',
        habits: uncategorized
      });
    }

    container.innerHTML = groups
      .filter(group => group.habits.length > 0 || group.id !== 'uncategorized')
      .map(group => `
        <section
          class="habit-category"
          data-category-id="${group.id}"
          ondragover="event.preventDefault()"
          ondrop="App.dropHabit(event, '${group.id}')">

          <div class="habit-category-header">
            <h3>${this.escapeHtml(group.name)}</h3>
            <span>${group.habits.length}</span>
          </div>

          <div class="habit-category-list">
            ${group.habits.map(h => this.renderHabitCard(h)).join('')}
          </div>
        </section>
      `).join('');

    console.log('[UI.renderHabits] HTML successfully updated.');
    this.updateProgress(habitsList);
    this.initSwipeEvents(habitsList);
  },

  renderHabitCard(h) {
    const currentCount = h.weekCountBeforeToday + (h.completed ? 1 : 0);
    const targetText = h.weekly_target ? `${currentCount}/${h.weekly_target} this week` : '';
    const timeText = this.formatMinutes(h.target_minutes);
    const subInfo = [targetText, timeText].filter(Boolean).join(' • ');
    const fulfilled = !!h.weeklyGoalMetBeforeToday;

    const fulfilledBadge = fulfilled
      ? `<span class="habit-fulfilled-badge">✓ Weekly goal met (${h.weekCountBeforeToday}/${h.weekly_target || 7})</span>`
      : '';

    return `
      <div
        class="habit-card-wrapper"
        draggable="true"
        data-habit-id="${h.id}"
        ondragstart="App.draggedHabitId='${h.id}'">

        <div class="swipe-actions">
          <button
            class="swipe-btn edit"
            onclick="App.openEditModal('${h.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>

          <button
            class="swipe-btn delete"
            onclick="App.handleDeleteHabit('${h.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>

        <div class="habit-item ${fulfilled ? 'habit-fulfilled' : ''}" id="swipe-content-${h.id}">
          <div class="drag-handle" title="Drag to reorder">⋮⋮</div>

          <div class="habit-info">
            <span class="habit-name">${this.escapeHtml(h.title)}</span>
            <span class="habit-time">${subInfo}</span>
            ${fulfilledBadge}
          </div>

          <div id="switch-wrapper-${h.id}">
            <label class="switch">
              <input
                type="checkbox"
                ${h.completed ? 'checked' : ''}
                onchange="App.handleToggleHabit('${h.id}')">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    `;
  },

  updateProgress(habitsList) {
    habitsList.forEach(h => {
      const card = document.getElementById(`swipe-content-${h.id}`);
      if (!card) return;

      const weeklyTarget = h.weekly_target || 7;
      const currentCount = h.weekCountBeforeToday + (h.completed ? 1 : 0);
      const fulfilled = currentCount >= weeklyTarget;

      const timeText = this.formatMinutes(h.target_minutes);
      const targetText = `${currentCount}/${weeklyTarget} this week`;
      const subInfo = [targetText, timeText].filter(Boolean).join(' • ');

      const habitTime = card.querySelector('.habit-time');
      if (habitTime) {
        habitTime.innerText = subInfo;
      }

      card.classList.toggle('habit-fulfilled', fulfilled);

      const habitInfo = card.querySelector('.habit-info');
      let badge = card.querySelector('.habit-fulfilled-badge');

      if (fulfilled) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'habit-fulfilled-badge';
          habitInfo.appendChild(badge);
        }

        badge.innerText = `✓ Weekly goal met (${currentCount}/${weeklyTarget})`;
      } else if (badge) {
        badge.remove();
      }
    });

    const relevant = habitsList.filter(h => !h.weeklyGoalMetBeforeToday);
    const completed = relevant.filter(h => h.completed).length;
    const total = relevant.length;
    const percent = total > 0 ? Math.round((completed / total) * 100) : 100;

    const textElem = document.getElementById('progress-text');
    const fillElem = document.getElementById('progress-fill');
    const band = this.getBandInfo(percent);

    if (textElem) {
      textElem.innerText = `${percent}%`;
      textElem.style.color = band.color;
      textElem.style.textShadow = `0 0 8px ${band.glow}`;
    }

    if (fillElem) {
      fillElem.style.width = `${percent}%`;
      fillElem.style.background = band.color;
      fillElem.style.boxShadow = `0 0 12px ${band.glow}`;
    }
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
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
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
        datasets: [{
          data: data,
          borderColor: '#00e676',
          backgroundColor: 'rgba(0, 230, 118, 0.15)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { min: 0, max: 100 } }
      }
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

    container.innerHTML = list.map(h => {
      const band = this.getBandInfo(h.percent);
      return `
        <div class="habit-stat-row">
          <span class="habit-stat-name">${this.escapeHtml(h.title)}</span>
          <span class="habit-stat-percent" style="color: ${band.color};">${h.percent}%</span>
          <div class="habit-stat-bar-bg">
            <div class="habit-stat-bar-fill" style="width: ${h.percent}%; background: ${band.color};"></div>
          </div>
        </div>
      `;
    }).join('');
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
        <span class="inactive-habit-name">${this.escapeHtml(h.title)}</span>
        <button
          class="btn-primary btn-sm"
          onclick="App.reactivateFromProfile('${h.id}')">
          Reactivate
        </button>
      </div>
    `).join('');
  },

  renderWeekWidget(days, title, dayNum) {
    const titleElem = document.getElementById('week-widget-title');
    const dayNumElem = document.getElementById('week-widget-daynum');
    const rowElem = document.getElementById('week-days-row');

    if (titleElem) titleElem.innerText = title;
    if (dayNumElem) dayNumElem.innerText = dayNum;

    if (rowElem) {
      rowElem.innerHTML = days.map(d => `
        <div class="week-day-pill ${d.isToday ? 'today' : ''}">
          <span class="week-day-label">${d.label}</span>
          <span class="week-day-dot ${d.status}"></span>
        </div>
      `).join('');
    }
  },

  getBandClass(percent) {
    if (percent < 30) return 'band-red';
    if (percent < 55) return 'band-orange';
    if (percent < 75) return 'band-yellow';
    return 'band-green';
  },

  renderHeatmap(dailyResults, frozenDates) {
    const container = document.getElementById('heatmap-container');
    if (!container) return;

    if (!dailyResults || dailyResults.length === 0) {
      container.innerHTML = '<div class="loader">No activity yet.</div>';
      return;
    }

    const frozen = frozenDates || new Set();

    container.innerHTML = dailyResults.map(result => {
      const isFrozen = frozen.has(result.dateStr);
      const band = isFrozen ? 'band-frozen' : this.getBandClass(result.percent);
      const tooltip = isFrozen
        ? `${result.dateStr}: protected with a Habit Freeze`
        : `${result.dateStr}: ${result.percent}%`;

      return `
        <div
          class="heatmap-cell ${band}"
          title="${tooltip}">
        </div>
      `;
    }).join('');
  },

  renderStreaks(current, best, todayQualifies) {
    console.log('[UI.renderStreaks] current:', current, 'best:', best, 'todayQualifies:', todayQualifies);
    const currentElem = document.getElementById('current-streak-value');
    const bestElem = document.getElementById('best-streak-value');
    const statusElem = document.getElementById('streak-status-label');

    if (currentElem) {
      currentElem.innerText = current;
      currentElem.classList.toggle('pending', !todayQualifies);
      currentElem.classList.toggle('secured', todayQualifies);
    }

    if (bestElem) bestElem.innerText = best;

    if (statusElem) {
      if (todayQualifies) {
        statusElem.innerText = '✅ Secured for today';
        statusElem.classList.remove('pending');
        statusElem.classList.add('secured');
      } else {
        statusElem.innerText = '🔒 Complete today to keep it';
        statusElem.classList.remove('secured');
        statusElem.classList.add('pending');
      }
    }
  },

  renderAchievements(list) {
    console.log('[UI.renderAchievements] Rendering achievements:', list);
    const container = document.getElementById('achievements-container');
    if (!container) return;

    if (!list || list.length === 0) {
      container.innerHTML = '<div class="loader">No achievements yet.</div>';
      return;
    }

    const unlockedCount = list.filter(a => a.unlocked).length;

    const gridHtml = list.map((a, index) => {
      const dateHtml = a.unlocked && a.unlockedAt
        ? `<span class="badge-date">${this.formatBadgeDate(a.unlockedAt)}</span>`
        : '';

      return `
        <div
          class="badge ${a.unlocked ? 'badge-unlocked' : 'badge-locked'}"
          onclick="App.openAchievementModal(${index})">

          <div class="badge-icon">
            <span class="iconify" data-icon="${a.icon}"></span>
          </div>

          <div class="badge-name">${this.escapeHtml(a.name)}</div>
          ${dateHtml}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="badge-summary">${unlockedCount} / ${list.length} unlocked</div>
      <div class="badge-grid">${gridHtml}</div>
    `;
  },

  freezeBadgeInnerHTML(state) {
    const { freezeCount, maxFreezeCount, nextRefillAt } = state;
    const full = freezeCount >= maxFreezeCount;
    const countdownText = full ? 'Full' : (this.formatCountdown(nextRefillAt) || '');

    return `
      <span class="freeze-pill ${full ? 'full' : ''}">
        <span class="iconify freeze-badge-icon" data-icon="game-icons:ice-cube"></span>
        <span class="freeze-badge-count">${freezeCount}/${maxFreezeCount}</span>
        <span class="freeze-badge-sep">•</span>
        <span class="freeze-countdown-text">${countdownText}</span>
      </span>
    `;
  },

  formatCountdown(targetMs) {
    if (!targetMs) return null;
    const diff = targetMs - Date.now();
    if (diff <= 0) return 'Any moment';
    const totalMinutes = Math.floor(diff / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  },

  updateFreezeCountdowns(nextRefillAt, isFull) {
    const text = isFull ? 'Full' : (this.formatCountdown(nextRefillAt) || '');
    document.querySelectorAll('.freeze-countdown-text').forEach(el => {
      el.innerText = text;
    });
  },

  renderFreezeBadgeHome(state) {
    const mount = document.getElementById('freeze-badge-home');
    if (!mount || !state) return;
    mount.innerHTML = this.freezeBadgeInnerHTML(state);
  },

  pendingAlertHTML(pendingMissedDates, freezeCount) {
    if (!pendingMissedDates || pendingMissedDates.length === 0) return '';

    const dateStr = pendingMissedDates[0];
    const prettyDate = this.formatFreezeDate(dateStr);
    const moreText = pendingMissedDates.length > 1
      ? `<div class="freeze-alert-more">+${pendingMissedDates.length - 1} more day${pendingMissedDates.length - 1 === 1 ? '' : 's'} to review after this</div>`
      : '';

    return `
      <div class="freeze-alert">
        <div class="freeze-alert-text">⚠️ You missed <strong>${prettyDate}</strong> — no habit was checked off that day.</div>
        <div class="freeze-alert-actions">
          <button class="btn-primary btn-sm" ${freezeCount === 0 ? 'disabled' : ''} onclick="App.resolvePendingFreeze('${dateStr}', true)">Use a Freeze</button>
          <button class="btn-secondary btn-sm" onclick="App.resolvePendingFreeze('${dateStr}', false)">Let it break</button>
        </div>
        ${moreText}
      </div>
    `;
  },

  renderFreezeCard(state) {
    const container = document.getElementById('freeze-card-body');
    if (!container || !state) return;

    const { freezeCount, pendingMissedDates } = state;

    const html =
      `<div class="freeze-badge-row">${this.freezeBadgeInnerHTML(state)}</div>` +
      this.pendingAlertHTML(pendingMissedDates, freezeCount);

    container.innerHTML = html;
  },

  openFreezeModal(state) {
    console.log('[UI.openFreezeModal] called with pendingMissedDates:', state && state.pendingMissedDates);
    const modal = document.getElementById('freeze-decision-modal');
    const body = document.getElementById('freeze-modal-body');
    if (!modal || !body) {
      console.warn('[UI.openFreezeModal] #freeze-decision-modal or #freeze-modal-body not found in the DOM.');
      return;
    }
    if (!state) return;
    if (!state.pendingMissedDates || state.pendingMissedDates.length === 0) {
      this.closeFreezeModal();
      return;
    }
    body.innerHTML = this.pendingAlertHTML(state.pendingMissedDates, state.freezeCount);
    modal.style.display = 'flex';
    console.log('[UI.openFreezeModal] modal opened.');
  },

  closeFreezeModal() {
    const modal = document.getElementById('freeze-decision-modal');
    if (modal) modal.style.display = 'none';
  },

  isFreezeModalOpen() {
    const modal = document.getElementById('freeze-decision-modal');
    return !!modal && modal.style.display !== 'none';
  },

  formatFreezeDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  },

  formatBadgeDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  showAchievementDetail(achievement) {
    const modal = document.getElementById('achievement-modal');
    const iconElem = document.getElementById('achievement-modal-icon');
    const nameElem = document.getElementById('achievement-modal-name');
    const descElem = document.getElementById('achievement-modal-desc');
    const statusElem = document.getElementById('achievement-modal-status');

    if (iconElem) iconElem.innerHTML = `<span class="iconify" data-icon="${achievement.icon}"></span>`;
    if (nameElem) nameElem.innerText = achievement.name;
    if (descElem) descElem.innerText = achievement.description;
    if (statusElem) {
      if (achievement.unlocked) {
        const dateStr = achievement.unlockedAt
          ? new Date(achievement.unlockedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
          : null;
        statusElem.innerText = dateStr ? `✅ Achieved — ${dateStr}` : '✅ Achieved';
        statusElem.className = 'achievement-modal-status unlocked';
      } else {
        statusElem.innerText = '🔒 Locked';
        statusElem.className = 'achievement-modal-status locked';
      }
    }

    if (modal) modal.style.display = 'flex';
  }
};
