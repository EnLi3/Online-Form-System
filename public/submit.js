// public/submit.js
const token = sessionStorage.getItem('clinic_token');
const savedUser = sessionStorage.getItem('clinic_user');

// Redirect to login if unauthenticated or if user is an ADMIN
if (!token || !savedUser) {
  window.location.href = '/index.html';
}

const currentUser = JSON.parse(savedUser);
if (currentUser.role === 'ADMIN') {
  alert('Admins cannot submit sales reports.');
  window.location.href = '/index.html';
}

// Display Submitting User Hierarchy
document.addEventListener('DOMContentLoaded', () => {
  const badge = document.getElementById('userMetaBadge');
  if (badge) {
    let meta = `Logged in as: ${currentUser.full_name} (${currentUser.role}) | Region: ${currentUser.zone_name || 'All'} - ${currentUser.team_name || 'All'}`;
    badge.innerText = meta;
  }
});

async function handleDedicatedSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.innerText = 'Submitting & Compressing...';

  try {
    const formData = new FormData(form);
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Submission failed');
      submitBtn.disabled = false;
      submitBtn.innerText = 'Submit Report for Approval';
      return;
    }

    alert(data.message);
    window.location.href = '/index.html'; // Return to Dashboard
  } catch (err) {
    alert('Error submitting report: ' + err.message);
    submitBtn.disabled = false;
    submitBtn.innerText = 'Submit Report for Approval';
  }
}