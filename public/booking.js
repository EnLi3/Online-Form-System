// public/booking.js
const token = sessionStorage.getItem('clinic_token');
if (!token) {
  window.location.href = '/index.html';
}

document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date();
  const dateInput = document.getElementById('bf_date');
  if (dateInput) dateInput.value = today.toISOString().slice(0, 10);

  // Auto-generate unique booking REF No (e.g., WIN-202610-9482)
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const autoRefNo = `WIN-${year}${month}-${randomNum}`;
  
  const refInput = document.getElementById('bf_ref');
  if (refInput) {
    refInput.value = autoRefNo;
  }

  // Fetch Tier 1 Directors for the dropdown robustly
  try {
    const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const users = await res.json();
      const directors = users.filter(u => {
        const role = (u.role || '').trim().toUpperCase();
        const status = (u.status || '').trim().toUpperCase();
        return role === 'TIER_1' && status === 'ACTIVE';
      });

      const selectEl = document.getElementById('bf_director_name');
      if (selectEl && directors.length > 0) {
        selectEl.innerHTML = directors.map(d => 
          `<option value="${d.full_name} (Sales Director - T1)">${d.full_name} (Sales Director - T1)</option>`
        ).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load directors:', err);
  }

  updateBookingPreview();
});

function formatShortDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }).replace(/ /g, '/');
}

function formatLongDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function updateBookingPreview() {
  const dateVal = document.getElementById('bf_date').value;
  const refVal = document.getElementById('bf_ref').value;
  const instName = document.getElementById('bf_inst_name').value || 'Sunway Medical Centre Velocity';
  const instAddr = document.getElementById('bf_inst_address').value || '-';
  const compName = document.getElementById('bf_comp_name').value || '-';
  const regNo = document.getElementById('bf_reg_no').value || '-';
  const pic = document.getElementById('bf_pic').value || '-';
  const matType = document.getElementById('bf_material_type').value || 'Poster Small';
  const qty = Number(document.getElementById('bf_qty').value || 1);
  const startDate = document.getElementById('bf_start_date').value;
  const endDate = document.getElementById('bf_end_date').value;
  const monthlyRate = Number(document.getElementById('bf_monthly_rate').value || 0);
  const months = Number(document.getElementById('bf_months').value || 1);
  const payee = document.getElementById('bf_payee').value || '-';
  const bankName = document.getElementById('bf_bank_name').value || 'Maybank';
  const bankAcc = document.getElementById('bf_bank_acc').value || '-';
  const space = document.getElementById('bf_space').value || 'Consultation Suite';
  const selectedDirector = document.getElementById('bf_director_name').value || 'David (Sales Director - T1)';
  // Calculations
  const totalRentalPerMonth = qty * monthlyRate;
  const grandTotal = totalRentalPerMonth * months;
  const formattedTotal = `RM ${grandTotal.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const formattedRate = `RM ${monthlyRate.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  const formattedMonthlyRental = `RM ${totalRentalPerMonth.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

  // Automatically construct Item 7 Text based on calculated grand total
  const autoFeeText = `The agreed fee payable on a lump sum basis for provision of the space shall be<br><b>Ringgit Malaysia (${formattedTotal})</b>`;

  // Bind to Previews
  document.getElementById('pv_date').innerText = formatLongDate(dateVal);
  document.getElementById('pv_ref').innerText = refVal;
  document.getElementById('pv_inst_name').innerText = instName;
  document.getElementById('pv_inst_address').innerText = instAddr;
  document.getElementById('pv_comp_name').innerText = compName;
  document.getElementById('pv_reg_no').innerText = regNo;
  document.getElementById('pv_pic').innerText = pic;
  
  // Item 7 auto-update
  document.getElementById('pv_fee_words').innerHTML = autoFeeText;

  document.getElementById('pv_payee').innerText = payee;
  document.getElementById('pv_bank_acc').innerText = bankAcc;
  document.getElementById('pv_bank_name').innerText = bankName;
  document.getElementById('pv_space').innerText = space;

  // Appendix Table 1 Binding
  document.getElementById('pv_mat_header').innerText = matType;
  document.getElementById('pv_unit_rate_header').innerText = formattedRate;
  document.getElementById('pv_start').innerText = formatShortDate(startDate);
  document.getElementById('pv_end').innerText = formatShortDate(endDate);
  document.getElementById('pv_qty').innerText = qty;
  document.getElementById('pv_rental_rate').innerText = formattedMonthlyRental;
  document.getElementById('pv_months').innerText = months;
  document.getElementById('pv_amount').innerText = formattedTotal;
  document.getElementById('pv_total_amount').innerText = formattedTotal;

  // Acknowledgement section
  document.getElementById('pv_ack_clinic').innerText = instName;
  document.getElementById('pv_ack_behalf').innerText = compName !== '-' ? compName : instName;
  document.getElementById('pv_ack_pic').innerText = pic !== '-' ? pic : '';
  // If you display the director's name in the footer/signature section of the preview:
  const dirPreviewEl = document.getElementById('pv_director_name');
  if (dirPreviewEl) {
    dirPreviewEl.innerText = selectedDirector;
  }
}

async function submitBookingReport(e) {
  e.preventDefault();
  
  const formData = new FormData();
  formData.append('ref_no', document.getElementById('bf_ref').value);
  formData.append('clinic_name', document.getElementById('bf_inst_name').value);
  formData.append('address', document.getElementById('bf_inst_address').value);
  formData.append('company_name', document.getElementById('bf_comp_name').value);
  formData.append('reg_no', document.getElementById('bf_reg_no').value);
  formData.append('pic_name', document.getElementById('bf_pic').value);
  formData.append('material', document.getElementById('bf_material_type').value);
  formData.append('space', document.getElementById('bf_space').value);
  formData.append('start_date', document.getElementById('bf_start_date').value);
  formData.append('end_date', document.getElementById('bf_end_date').value);
  formData.append('amount_paid', (Number(document.getElementById('bf_monthly_rate').value) * Number(document.getElementById('bf_qty').value) * Number(document.getElementById('bf_months').value)));
  formData.append('payee', document.getElementById('bf_payee').value);
  formData.append('bank_name', document.getElementById('bf_bank_name').value);
  formData.append('bank_acc', document.getElementById('bf_bank_acc').value);
  formData.append('director_name', document.getElementById('bf_director_name').value);

  // Attach clinic photo proof if selected
  const photoInput = document.getElementById('bf_photos');
  if (photoInput && photoInput.files[0]) {
    for (let i = 0; i < photoInput.files.length; i++) {
      formData.append('photos', photoInput.files[i]);
    }
  }

  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });

  const data = await res.json();
  if (!res.ok) return alert(data.error || 'Failed to submit booking report');

  alert('Booking report submitted successfully for Tier approval!');
  window.location.href = '/index.html';
}

function exportBookingPDF() {
  const printContent = document.getElementById('bookingPrintArea');
  if (!printContent) return;

  let printFrame = document.getElementById('booking_print_frame');
  if (printFrame) document.body.removeChild(printFrame);

  printFrame = document.createElement('iframe');
  printFrame.id = 'booking_print_frame';
  printFrame.style.position = 'fixed';
  printFrame.style.width = '0';
  printFrame.style.height = '0';
  printFrame.style.border = '0';
  document.body.appendChild(printFrame);

  const frameDoc = printFrame.contentWindow || printFrame.contentDocument.document || printFrame.contentDocument;
  frameDoc.document.open();
  frameDoc.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Space Rental Booking Form - ${document.getElementById('bf_ref').value}</title>
      <style>
        @page {
          size: A4 portrait;
          margin: 12mm 15mm 12mm 15mm;
        }
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          box-sizing: border-box !important;
        }
        body {
          margin: 0;
          padding: 0;
          background: #fff;
        }
      </style>
    </head>
    <body>
      ${printContent.innerHTML}
    </body>
    </html>
  `);
  frameDoc.document.close();

  setTimeout(() => {
    printFrame.contentWindow.focus();
    printFrame.contentWindow.print();
  }, 250);


  document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('bf_date').value = today;

  // Fetch Tier 1 Directors for the dropdown
  try {
    const res = await fetch('/api/users', { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) {
      const users = await res.json();
      const directors = users.filter(u => u.role === 'TIER_1' && u.status === 'ACTIVE');
      const selectEl = document.getElementById('bf_director_name');
      if (directors.length > 0) {
        selectEl.innerHTML = directors.map(d => `<option value="${d.full_name} (Sales Director - T1)">${d.full_name} (Sales Director - T1)</option>`).join('');
      }
    }
  } catch (err) {
    console.error('Failed to load directors:', err);
  }

  updateBookingPreview();
});
}