// For local development:
//const API_BASE = 'http://localhost:3000/api';

// For production (Vercel), comment the above and uncomment below:
const API_BASE = '/api';
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

let authToken = localStorage.getItem('authToken');
let isRep = false;
let timetableData = null;
let editingDay = null;
let editingIndex = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadTimetable();
    if (authToken) await verifyToken();
});

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');
    
    errorEl.style.display = 'none';
    
    if (!email || !password) {
        errorEl.textContent = 'Email and password required';
        errorEl.style.display = 'block';
        return;
    }
    
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';
    
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Login failed');
        
        authToken = data.token;
        localStorage.setItem('authToken', authToken);
        isRep = true;
        updateUIForRep(data.user);
        closeModal('loginModal');
        await loadTimetable();
        showNotification('Welcome back, ' + data.user.name + '!', 'success');
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '🔓 Sign In';
    }
}

async function verifyToken() {
    try {
        const response = await fetch(`${API_BASE}/auth/verify`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (response.ok) {
            const data = await response.json();
            isRep = true;
            updateUIForRep(data.user);
            await loadTimetable();
        } else {
            logout(false);
        }
    } catch (error) {
        logout(false);
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorEl = document.getElementById('passwordError');
    const successEl = document.getElementById('passwordSuccess');
    
    errorEl.style.display = 'none';
    successEl.style.display = 'none';
    
    if (!currentPassword || !newPassword || !confirmPassword) {
        errorEl.textContent = 'All fields are required';
        errorEl.style.display = 'block';
        return;
    }
    if (newPassword.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters';
        errorEl.style.display = 'block';
        return;
    }
    if (newPassword !== confirmPassword) {
        errorEl.textContent = 'Passwords do not match';
        errorEl.style.display = 'block';
        return;
    }
    
    try {
        const response = await fetch(`${API_BASE}/auth/change-password`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        successEl.textContent = 'Password changed!';
        successEl.style.display = 'block';
        document.getElementById('currentPassword').value = '';
        document.getElementById('newPassword').value = '';
        document.getElementById('confirmPassword').value = '';
        setTimeout(() => closeModal('passwordModal'), 2000);
        showNotification('Password updated!', 'success');
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
    }
}

function logout(showMsg = true) {
    authToken = null;
    isRep = false;
    localStorage.removeItem('authToken');
    updateUIForPublic();
    loadTimetable();
    if (showMsg) showNotification('Signed out', 'info');
}

async function loadTimetable() {
    showLoading();
    try {
        const response = await fetch(`${API_BASE}/timetable`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        timetableData = data;
        renderTimetable();
        updateTimestamp(data.lastModifiedAt);
        hideLoading();
    } catch (error) {
        hideLoading();
        timetableData = getDefaultData();
        renderTimetable();
        showNotification('Using offline data', 'error');
    }
}

function renderTimetable() {
    const tbody = document.getElementById('timetableBody');
    if (!timetableData?.schedule) { showEmptyState(); return; }
    
    const timeSlots = new Set();
    DAYS.forEach(day => {
        (timetableData.schedule[day] || []).forEach(course => {
            if (course.time) timeSlots.add(course.time);
        });
    });
    
    if (timeSlots.size === 0) { showEmptyState(); return; }
    
    hideEmptyState();
    document.getElementById('timetable').style.display = 'table';
    
    const sortedTimes = Array.from(timeSlots).sort((a, b) => parseInt(a.replace(':', '')) - parseInt(b.replace(':', '')));
    tbody.innerHTML = '';
    
    sortedTimes.forEach(time => {
        const row = document.createElement('tr');
        const timeCell = document.createElement('td');
        timeCell.className = 'time-slot';
        timeCell.innerHTML = time.replace(' - ', '<br>');
        row.appendChild(timeCell);
        
        DAYS.forEach(day => {
            const cell = document.createElement('td');
            const courses = (timetableData.schedule[day] || []).filter(c => c.time === time);
            
            if (courses.length > 0) {
                courses.forEach(course => {
                    const card = document.createElement('div');
                    card.className = 'course-card';
                    card.innerHTML = `<div class="course-name">${escapeHtml(course.course)}</div><div class="course-info">📍 ${escapeHtml(course.venue || 'TBA')}</div>${course.code ? `<div class="course-code">${escapeHtml(course.code)}</div>` : ''}`;
                    if (isRep) {
                        card.style.cursor = 'pointer';
                        card.title = 'Click to edit';
                        card.onclick = (e) => { e.stopPropagation(); openEditModal(day, timetableData.schedule[day].indexOf(course)); };
                    }
                    cell.appendChild(card);
                });
            } else {
                cell.innerHTML = '<div class="empty-slot">—</div>';
            }
            
            if (isRep) {
                cell.classList.add('editable-cell');
                cell.onclick = (e) => { if (e.target === cell || e.target.classList.contains('empty-slot')) openEditModal(day, -1, time); };
            }
            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
}

async function saveCourse() {
    const day = document.getElementById('editDay').value.toLowerCase();
    const time = document.getElementById('editTime').value.trim();
    const course = document.getElementById('editCourse').value.trim();
    const venue = document.getElementById('editVenue').value.trim();
    const code = document.getElementById('editCode').value.trim();
    const errorEl = document.getElementById('editError');
    
    errorEl.style.display = 'none';
    if (!time || !course) { errorEl.textContent = 'Time and course name required'; errorEl.style.display = 'block'; return; }
    
    if (!timetableData.schedule[day]) timetableData.schedule[day] = [];
    if (editingIndex >= 0) {
        timetableData.schedule[day][editingIndex] = { time, course, venue, code };
    } else {
        timetableData.schedule[day].push({ time, course, venue, code });
    }
    
    try {
        const response = await fetch(`${API_BASE}/timetable`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ schedule: timetableData.schedule })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        renderTimetable();
        updateTimestamp(data.lastModifiedAt);
        closeModal('editModal');
        showNotification('Timetable updated!', 'success');
    } catch (error) {
        errorEl.textContent = error.message;
        errorEl.style.display = 'block';
        await loadTimetable();
    }
}

async function deleteCourse() {
    if (editingIndex < 0) return;
    if (!confirm('Delete this course?')) return;
    try {
        const response = await fetch(`${API_BASE}/timetable/lesson`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
            body: JSON.stringify({ day: editingDay, courseIndex: editingIndex })
        });
        if (!response.ok) throw new Error('Delete failed');
        await loadTimetable();
        closeModal('editModal');
        showNotification('Course deleted', 'info');
    } catch (error) {
        showNotification(error.message, 'error');
        await loadTimetable();
    }
}

function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPassword').value = '';
    setTimeout(() => document.getElementById('loginEmail').focus(), 100);
}

function showChangePasswordModal() {
    document.getElementById('passwordModal').classList.add('active');
    document.getElementById('passwordError').style.display = 'none';
    document.getElementById('passwordSuccess').style.display = 'none';
    document.getElementById('currentPassword').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
}

function openEditModal(day, index, defaultTime = '') {
    if (!isRep) return;
    editingDay = day;
    editingIndex = index;
    document.getElementById('editDay').value = day.charAt(0).toUpperCase() + day.slice(1);
    document.getElementById('editError').style.display = 'none';
    document.getElementById('editSuccess').style.display = 'none';
    
    if (index >= 0 && timetableData.schedule[day]?.[index]) {
        const course = timetableData.schedule[day][index];
        document.getElementById('editTime').value = course.time || '';
        document.getElementById('editCourse').value = course.course || '';
        document.getElementById('editVenue').value = course.venue || '';
        document.getElementById('editCode').value = course.code || '';
        document.getElementById('deleteBtn').style.display = 'block';
        document.getElementById('editTitle').textContent = '✏️ Edit Course';
    } else {
        document.getElementById('editTime').value = defaultTime;
        document.getElementById('editCourse').value = '';
        document.getElementById('editVenue').value = '';
        document.getElementById('editCode').value = '';
        document.getElementById('deleteBtn').style.display = 'none';
        document.getElementById('editTitle').textContent = '➕ Add Course';
    }
    document.getElementById('editModal').classList.add('active');
    setTimeout(() => document.getElementById('editCourse').focus(), 100);
}

function closeModal(modalId) { document.getElementById(modalId).classList.remove('active'); }

function updateUIForRep(user) {
    document.getElementById('loginBtn').style.display = 'none';
    document.getElementById('logoutBtn').style.display = 'flex';
    document.getElementById('repBadge').style.display = 'inline-flex';
    document.getElementById('repNameDisplay').textContent = user.name || 'rep';
    document.getElementById('viewMode').textContent = '✏️ Edit Mode';
    document.getElementById('viewMode').style.background = '#dbeafe';
    document.getElementById('viewMode').style.color = '#1e40af';
    document.getElementById('repBadge').onclick = showChangePasswordModal;
}

function updateUIForPublic() {
    document.getElementById('loginBtn').style.display = 'flex';
    document.getElementById('logoutBtn').style.display = 'none';
    document.getElementById('repBadge').style.display = 'none';
    document.getElementById('viewMode').textContent = '👥 Public View';
    document.getElementById('viewMode').style.background = '#e0e7ff';
    document.getElementById('viewMode').style.color = '#4338ca';
}

function updateTimestamp(timestamp) {
    const el = document.getElementById('lastUpdated');
    if (timestamp) {
        el.textContent = '🕐 Last updated: ' + new Date(timestamp).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } else {
        el.textContent = '🕐 Not yet updated';
    }
}

function showLoading() {
    document.getElementById('loadingState').style.display = 'block';
    document.getElementById('timetable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';
}

function hideLoading() { document.getElementById('loadingState').style.display = 'none'; }

function showEmptyState() {
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('timetable').style.display = 'none';
    document.getElementById('emptyState').style.display = 'block';
}

function hideEmptyState() { document.getElementById('emptyState').style.display = 'none'; }

function showNotification(message, type = 'info') {
    const n = document.getElementById('notification');
    n.textContent = message;
    n.className = 'notification ' + type;
    n.style.display = 'block';
    clearTimeout(n._timeout);
    n._timeout = setTimeout(() => n.style.display = 'none', 3500);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function getDefaultData() {
    return {
        schedule: {
            monday: [],
            tuesday: [
                { course: 'Entrepreneurship Principles and Practice', time: '08:00 - 11:00', venue: 'Virtual Zoom', code: 'CDU 402' },
                { course: 'Introduction to Programming', time: '15:00 - 19:00', venue: 'TC 2-3-3 / Virtual Lab', code: 'STU 501' }
            ],
            wednesday: [
                { course: 'System Analysis and Design', time: '08:00 - 11:00', venue: 'Virtual Zoom', code: 'STU 502' }
            ],
            thursday: [
                { course: 'Data Structure and Algorithm', time: '07:00 - 11:00', venue: 'TC 2-3-3', code: 'STU 602' },
                { course: 'Data Structure and Algorithm', time: '11:00 - 15:00', venue: 'TC 2-3-3', code: 'STU 602' },
                { course: 'Data Structure and Algorithm', time: '16:00 - 19:00', venue: 'TC 2-3-3', code: 'STU 602' }
            ],
            friday: [
                { course: 'Fundamentals of Computer Networks', time: '12:00 - 16:00', venue: 'TC 3-1 / TC 3-8', code: 'CSN 501' },
                { course: 'Introduction to Programming', time: '07:00 - 11:00', venue: 'TC 2-3-3', code: 'STU 501' },
                { course: 'Introduction to Programming', time: '15:00 - 19:00', venue: 'TC 2-3-3 / Virtual Lab', code: 'STU 501' }
            ]
        }
    };
}

window.onclick = function(event) { if (event.target.classList.contains('modal')) event.target.classList.remove('active'); };
document.addEventListener('keydown', function(event) { if (event.key === 'Escape') document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active')); });