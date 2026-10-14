import { api, escape, money } from './common.js';

let user = null;
let opener;
const authDialog = document.querySelector('#auth-dialog');
const accountDialog = document.querySelector('#account-dialog');
const feedback = document.querySelector('#auth-feedback');
const menu = document.querySelector('#account-menu');
const toggle = document.querySelector('#account-toggle');
const loginForm = document.querySelector('#customer-login-form');
const registerForm = document.querySelector('#customer-register-form');
const tabs = [...document.querySelectorAll('.auth-tabs [role="tab"]')];

function syncProfile() {
  document.querySelector('#auth-open').hidden = !!user;
  // These elements use display:flex; hidden must explicitly hide the trigger.
  document.querySelector('#auth-open').style.display = user ? 'none' : '';
  document.querySelector('#customer-profile').hidden = !user;
  document.querySelector('#customer-name').textContent = user?.name || '';
  document.querySelector('#customer-avatar').textContent = user ? user.name.trim().split(/\s+/).slice(-2).map(s => s[0]).join('').toUpperCase() : '';
  toggle.setAttribute('aria-label', user ? `Tài khoản ${user.name}` : 'Tài khoản');
  closeMenu();
}
function closeMenu() { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
function selectTab(tab) {
  tabs.forEach(button => {
    const active = button === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !active;
  });
  feedback.textContent = '';
  document.querySelector('#forgot-message').hidden = true;
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : (index + 1) % tabs.length;
    selectTab(tabs[next]); tabs[next].focus();
  });
});
document.querySelector('#auth-open').addEventListener('click', event => {
  opener = event.currentTarget;
  selectTab(tabs[0]); authDialog.showModal(); document.body.classList.add('modal-open');
});
document.querySelector('#auth-close').addEventListener('click', () => authDialog.close());
document.querySelector('#account-close').addEventListener('click', () => accountDialog.close());
for (const dialog of [authDialog, accountDialog]) {
  dialog.addEventListener('click', event => {
    const rect = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('modal-open');
    loginForm.reset(); registerForm.reset();
    confirmation.setCustomValidity('');
    if (user) toggle.focus({ preventScroll: true }); else opener?.focus({ preventScroll: true });
  });
}
document.querySelector('#forgot-password').addEventListener('click', () => {
  const message = document.querySelector('#forgot-message'); message.hidden = !message.hidden;
});
const confirmation = document.querySelector('#register-confirm');
function validateConfirmation() { confirmation.setCustomValidity(confirmation.value !== document.querySelector('#register-password').value ? 'Mật khẩu nhập lại không khớp.' : ''); }
confirmation.addEventListener('input', validateConfirmation);
document.querySelector('#register-password').addEventListener('input', validateConfirmation);

for (const [form, url] of [[loginForm, '/api/auth/login'], [registerForm, '/api/auth/register']]) {
  form.addEventListener('submit', async event => {
    event.preventDefault(); const button = form.querySelector('[type="submit"]');
    button.disabled = true; feedback.textContent = 'Đang xử lý…';
    const body = Object.fromEntries(new FormData(form));
    if (form === loginForm) body.remember = form.elements.remember.checked;
    try {
      const data = await api(url, { method: 'POST', body: JSON.stringify(body) });
      user = data.user; syncProfile(); authDialog.close();
    } catch (error) { feedback.textContent = error.message; }
    finally { button.disabled = false; }
  });
}
toggle.addEventListener('click', () => { const open = menu.hidden; menu.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) menu.querySelector('button').focus(); });
document.addEventListener('click', event => { if (!event.target.closest('.customer-control')) closeMenu(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) { closeMenu(); toggle.focus(); } });
document.querySelector('.customer-control').addEventListener('focusout', event => { if (!event.currentTarget.contains(event.relatedTarget)) closeMenu(); });

async function refreshUser() {
  try { user = (await api('/api/auth/me')).user; }
  catch (error) { if (error.status === 401) user = null; }
  syncProfile();
}
document.querySelector('#customer-logout').addEventListener('click', async () => {
  const button = document.querySelector('#customer-logout'); button.disabled = true;
  try { await api('/api/auth/logout', { method: 'POST' }); user = null; syncProfile(); document.querySelector('#auth-open').focus(); }
  catch (error) { button.textContent = `Thử lại: ${error.message}`; }
  finally { button.disabled = false; }
});
const statusLabels = { pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao', completed: 'Hoàn tất', cancelled: 'Đã hủy' };
document.querySelectorAll('[data-account]').forEach(button => button.addEventListener('click', async () => {
  closeMenu(); opener = toggle;
  const content = document.querySelector('#account-content');
  const profile = button.dataset.account === 'profile';
  document.querySelector('#account-title').textContent = profile ? 'Tài khoản của tôi' : 'Lịch sử đơn hàng';
  content.textContent = 'Đang tải…'; accountDialog.showModal(); document.body.classList.add('modal-open');
  try {
    if (profile) {
      user = (await api('/api/auth/me')).user; syncProfile();
      content.innerHTML = [['Họ tên', user.name], ['Email', user.email], ['Điện thoại', user.phone]].map(([name, value]) => `<div class="account-detail"><span>${name}</span><strong>${escape(value)}</strong></div>`).join('');
    } else {
      const orders = await api('/api/account/orders');
      content.innerHTML = orders.length ? orders.map(order => `<article class="account-order"><div class="row"><strong>${escape(order.order_code)}</strong><strong>${money(order.total)}</strong></div><p class="my-3">${statusLabels[order.status]} · ${order.payment_method === 'cod' ? 'COD' : 'Chuyển khoản'} · ${order.payment_status === 'paid' ? 'Đã thanh toán' : 'Chưa xác nhận thanh toán'}</p><button class="secondary" type="button" data-order-detail="${order.id}">Chi tiết giao hàng</button><div data-order-address hidden></div><small>${new Date(order.created_at.replace(' ', 'T') + 'Z').toLocaleString('vi-VN')}</small>${order.items.map(item => `<div class="row"><span>${escape(item.product_name)}<small class="block mt-1">${escape(item.size)} / ${escape(item.color)} × ${item.quantity}</small></span><span>${money(item.unit_price * item.quantity)}</span></div>`).join('')}</article>`).join('') : '<p class="account-empty">Bạn chưa có đơn hàng trong tài khoản. Các đơn đặt sau khi đăng nhập sẽ xuất hiện ở đây.</p>';
    }
  } catch (error) { content.textContent = error.message; if (error.status === 401) { user = null; syncProfile(); } }
}));
window.addEventListener('pageshow', refreshUser);
document.querySelector('#account-content').addEventListener('click', async event => {
  const button=event.target.closest('[data-order-detail]');
  if(!button)return;
  button.disabled=true;
  try {
    const order=await api('/api/account/orders/'+button.dataset.orderDetail);
    const target=button.parentElement.querySelector('[data-order-address]');
    target.innerHTML=`<p>${escape(order.customer_name)} · ${escape(order.customer_phone)}</p><p>${escape(order.shipping_address)}</p><p>Vận chuyển: ${money(order.shipping_fee)}</p>${order.note?`<p>Ghi chú: ${escape(order.note)}</p>`:''}`;
    target.hidden=false;
  } catch(error) {button.textContent=error.message;}
  finally {button.disabled=false;}
});
await refreshUser();
