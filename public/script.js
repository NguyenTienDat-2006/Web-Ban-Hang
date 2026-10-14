import { api, money, escape, cart, setCart, updateCount, toast, fixImages, placeholder } from './assets/common.js';

const grid = document.querySelector('#products');
const status = document.querySelector('#status');
const categories = document.querySelector('#categories');
const retry = document.querySelector('#retry');
let products = [];
let selectedCategory = 0;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const minSlider = document.querySelector('#price-min');
const maxSlider = document.querySelector('#price-max');
let priceCeiling = 1000000;
let loaded = false;
const normalizeSearch = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLocaleLowerCase('vi');

function syncPriceLabel() {
  document.querySelector('#price-output').textContent = `${money(Number(minSlider.value))} — ${money(Number(maxSlider.value))}`;
  minSlider.setAttribute('aria-valuetext', money(Number(minSlider.value)));
  maxSlider.setAttribute('aria-valuetext', money(Number(maxSlider.value)));
}

function showSkeletons() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton skeleton-image"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div><div class="skeleton skeleton-button"></div></div>').join('');
}

function updateCartBadge() {
  updateCount();
  const count = cart().reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector('#cart-link').setAttribute('aria-label', `Giỏ hàng, ${count} món đồ`);
}

function render() {
  if (!loaded) return;
  const term = normalizeSearch(document.querySelector('#search').value.trim());
  const filtered = products.filter(p => (!selectedCategory || p.category_id === selectedCategory) && normalizeSearch(p.name).includes(term) && p.price >= Number(minSlider.value) && p.price <= Number(maxSlider.value));
  const sort=document.querySelector('#price-sort').value;
  if(sort!=='default')filtered.sort((a,b)=>sort==='asc'?a.price-b.price:b.price-a.price);
  status.textContent = `${filtered.length} sản phẩm`;
  grid.innerHTML = filtered.length ? filtered.map(p => {
    const available = p.variants.filter(v => v.stock > 0);
    return `<article class="shop-product" data-product="${p.id}">
      <img class="product-img" loading="lazy" src="${escape(p.image_url || placeholder)}" alt="${escape(p.name)}" width="600" height="800">
      <div class="shop-product-heading"><h3>${escape(p.name)}</h3><span class="shop-price">${money(p.price)}</span></div>
      <p class="text-xs text-neutral-500 mt-2">${escape(p.category_name)}</p>
      <button type="button" class="quick-trigger" data-quick="${p.id}" aria-haspopup="dialog" aria-label="Xem nhanh ${escape(p.name)}">Xem nhanh ↗</button>
      <label class="shop-variant" for="variant-${p.id}">Size / Màu</label>
      <select id="variant-${p.id}" class="field" data-variant ${available.length ? '' : 'disabled'}>
        ${available.length ? available.map(v => `<option value="${v.id}">${escape(v.size)} / ${escape(v.color)}</option>`).join('') : '<option>Hết hàng</option>'}
      </select>
      <button type="button" class="button" data-add="${p.id}" ${available.length ? '' : 'disabled'} aria-label="Thêm ${escape(p.name)} vào giỏ hàng">${available.length ? 'Thêm vào giỏ hàng' : 'Tạm hết hàng'}</button>
    </article>`;
  }).join('') : '<p class="empty-state">Không có sản phẩm phù hợp. Hãy thử danh mục hoặc từ khóa khác.</p>';
  fixImages();
}

async function loadProducts() {
  retry.hidden = true;
  grid.setAttribute('aria-busy', 'true');
  status.textContent = 'Đang tải sản phẩm…';
  showSkeletons();
  loaded = false;
  try {
    products = await api('/api/products');
    priceCeiling = Math.max(1000, Math.ceil(products.reduce((max, p) => Math.max(max, p.price), 0) / 1000) * 1000);
    minSlider.max = maxSlider.max = priceCeiling;
    minSlider.value = 0;
    maxSlider.value = priceCeiling;
    minSlider.disabled = maxSlider.disabled = !products.length;
    syncPriceLabel();
    loaded = true;
    const choices = [...new Map(products.map(p => [p.category_id, p.category_name])).entries()];
    if (!choices.some(([id]) => id === selectedCategory)) selectedCategory = 0;
    categories.innerHTML = [{ id: 0, name: 'Tất cả' }, ...choices.map(([id, name]) => ({ id, name }))]
      .map(c => `<button type="button" class="chip ${c.id === selectedCategory ? 'active' : ''}" data-category="${c.id}" aria-pressed="${c.id === selectedCategory}">${escape(c.name)}</button>`).join('');
    render();
  } catch (error) {
    grid.innerHTML = '<p class="empty-state">Bộ sưu tập chưa tải được. Hãy nhấn “Thử lại”.</p>';
    status.textContent = `Không thể tải sản phẩm. ${error.message}`;
    retry.hidden = false;
  } finally {
    grid.setAttribute('aria-busy', 'false');
  }
}

grid.addEventListener('click', event => {
  const quickButton = event.target.closest('[data-quick]');
  if (quickButton) { openQuickView(Number(quickButton.dataset.quick), quickButton); return; }
  const button = event.target.closest('[data-add]');
  if (!button) return;
  const product = products.find(p => p.id === Number(button.dataset.add));
  const variantId = Number(button.closest('[data-product]').querySelector('[data-variant]').value);
  const variant = product?.variants.find(v => v.id === variantId);
  addToCart(product, variant, 1);
});

function addToCart(product, variant, quantity) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    toast('Số lượng phải từ 1 đến 99.'); return false;
  }
  const items = cart();
  const existing = items.find(item => item.variant_id === variant?.id);
  if (!variant || (existing?.quantity || 0) + quantity > Math.min(variant.stock, 99)) {
    toast('Bạn đã thêm số lượng tối đa cho size / màu này.');
    return false;
  }
  if (existing) existing.quantity += quantity;
  else items.push({ variant_id: variant.id, quantity });
  try {
    setCart(items);
    updateCartBadge();
    toast(`Đã thêm ${product.name} · ${variant.size} / ${variant.color}`);
    return true;
  } catch {
    toast('Không thể lưu giỏ hàng. Hãy cho phép trình duyệt lưu dữ liệu trang web.');
    return false;
  }
}

const quickDialog = document.querySelector('#quick-view');
let quickOpener;
function openQuickView(id, opener) {
  const product = products.find(p => p.id === id);
  if (!product) return;
  quickOpener = opener;
  document.querySelector('#quick-content').innerHTML = `<div class="quick-layout"><img class="quick-image" src="${escape(product.image_url || placeholder)}" alt="${escape(product.name)}"><div class="quick-info"><p class="eyebrow">${escape(product.category_name)}</p><h2 id="quick-title">${escape(product.name)}</h2><p class="quick-price">${money(product.price)}</p><p class="quick-description">${escape(product.description || 'Chưa có mô tả cho sản phẩm này.')}</p><form id="quick-form"><label for="quick-variant">Size / Màu sắc</label><select id="quick-variant" class="field" ${product.variants.some(v => v.stock > 0) ? '' : 'disabled'}>${product.variants.map(v => `<option value="${v.id}" ${v.stock <= 0 ? 'disabled' : ''}>${escape(v.size)} / ${escape(v.color)}${v.stock <= 0 ? ' — Hết hàng' : ''}</option>`).join('')}</select><p id="quick-stock" role="status"></p><label for="quick-quantity">Số lượng</label><input id="quick-quantity" class="field" type="number" min="1" max="99" value="1" required><button id="quick-add" class="button" type="submit">Thêm vào giỏ hàng</button><p id="quick-feedback" role="status"></p></form><a href="/cart.html" class="quick-cart-link">Xem giỏ hàng →</a></div></div>`;
  const select = document.querySelector('#quick-variant');
  const quantity = document.querySelector('#quick-quantity');
  const feedback = document.querySelector('#quick-feedback');
  function syncVariant() {
    const variant = product.variants.find(v => v.id === Number(select.value));
    const inCart = cart().find(i => i.variant_id === variant?.id)?.quantity || 0;
    const available = variant ? Math.max(0, Math.min(variant.stock, 99) - inCart) : 0;
    document.querySelector('#quick-stock').textContent = available ? `Có thể thêm ${available} sản phẩm (tồn kho: ${variant.stock}).` : 'Hết hàng hoặc đã đạt số lượng tối đa trong giỏ.';
    quantity.max = Math.max(1, available);
    quantity.disabled = !available;
    quantity.value = Math.max(1, Math.min(Number(quantity.value) || 1, Math.max(1, available)));
    document.querySelector('#quick-add').disabled = !available;
  }
  select.addEventListener('change', () => { feedback.textContent = ''; syncVariant(); });
  document.querySelector('#quick-form').addEventListener('submit', event => {
    event.preventDefault();
    const variant = product.variants.find(v => v.id === Number(select.value));
    feedback.textContent = addToCart(product, variant, Number(quantity.value)) ? 'Đã thêm vào giỏ hàng.' : 'Không thể thêm. Kiểm tra số lượng và tồn kho.';
    syncVariant();
  });
  syncVariant();
  fixImages();
  quickDialog.showModal();
  document.body.classList.add('modal-open');
}
document.querySelector('#quick-close').addEventListener('click', () => quickDialog.close());
quickDialog.addEventListener('click', event => {
  const box = quickDialog.getBoundingClientRect();
  if (event.target === quickDialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) quickDialog.close();
});
quickDialog.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
  if (quickOpener?.isConnected) quickOpener.focus({ preventScroll: true });
});
for (const slider of [minSlider, maxSlider]) {
  slider.addEventListener('input', () => {
    if (Number(minSlider.value) > Number(maxSlider.value)) {
      if (slider === minSlider) maxSlider.value = minSlider.value;
      else minSlider.value = maxSlider.value;
    }
    syncPriceLabel(); render();
  });
}
document.querySelector('#reset-filters').addEventListener('click', () => {
  document.querySelector('#search').value = '';
  selectedCategory = 0;
  document.querySelector('#price-sort').value='default';
  minSlider.value = 0; maxSlider.value = priceCeiling;
  categories.querySelectorAll('button').forEach(button => {
    const active = Number(button.dataset.category) === 0;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  syncPriceLabel(); render();
});

categories.addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  selectedCategory = Number(button.dataset.category);
  categories.querySelectorAll('button').forEach(el => {
    el.classList.toggle('active', el === button);
    el.setAttribute('aria-pressed', String(el === button));
  });
  render();
});
document.querySelector('#search').addEventListener('input', render);
retry.addEventListener('click', loadProducts);
window.addEventListener('storage', event => {
  if (event.key === 'moc-cart' || event.key === null) updateCartBadge();
});
window.addEventListener('pageshow', updateCartBadge);
updateCartBadge();

// Dark / Light preference persists across reloads without blocking shopping.
const themeToggle = document.querySelector('#theme-toggle');
function syncTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeToggle.setAttribute('aria-pressed', String(!dark));
  themeToggle.setAttribute('aria-label', dark ? 'Bật chế độ sáng' : 'Bật chế độ tối');
  document.querySelector('#theme-icon').textContent = dark ? '☀' : '☾';
  document.querySelector('#theme-label').textContent = dark ? 'Light mode' : 'Dark mode';
}
themeToggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('moc-theme', theme); } catch { /* Preference is optional. */ }
  syncTheme();
});
syncTheme();

// Auto slider pauses on hover, keyboard focus, hidden tabs and reduced motion.
const hero = document.querySelector('#hero-slider');
const slides = [...hero.querySelectorAll('.hero-slide')];
const dots = [...hero.querySelectorAll('[data-slide]')];
const words = ['NEXT ERA.', 'OWN RULES.', 'NEW ENERGY.'];
const descriptions = ['Bước ra khỏi khuôn mẫu. Mặc theo cách riêng của bạn.', 'Không cần theo số đông. Chọn điều khiến bạn tự tin.', 'Một tủ đồ mới. Một nguồn cảm hứng cho mỗi ngày.'];
let slide = 0;
let paused = reducedMotion.matches;
let hovering = false;
function showSlide(index) {
  slide = (index + slides.length) % slides.length;
  slides.forEach((image, i) => { image.classList.toggle('active', i === slide); image.setAttribute('aria-hidden', String(i !== slide)); });
  dots.forEach((dot, i) => { dot.classList.toggle('active', i === slide); dot.setAttribute('aria-pressed', String(i === slide)); });
  document.querySelector('#hero-word').textContent = words[slide];
  document.querySelector('#hero-description').textContent = descriptions[slide];
}
function syncPause() {
  const button = document.querySelector('#slider-pause');
  button.textContent = paused ? '▶' : 'Ⅱ';
  button.setAttribute('aria-label', paused ? 'Tiếp tục trình chiếu' : 'Tạm dừng trình chiếu');
}
dots.forEach(dot => dot.addEventListener('click', () => showSlide(Number(dot.dataset.slide))));
document.querySelector('#slider-prev').addEventListener('click', () => showSlide(slide - 1));
document.querySelector('#slider-next').addEventListener('click', () => showSlide(slide + 1));
document.querySelector('#slider-pause').addEventListener('click', () => { paused = !paused; syncPause(); });
hero.addEventListener('mouseenter', () => { hovering = true; });
hero.addEventListener('mouseleave', () => { hovering = false; });
reducedMotion.addEventListener('change', () => { paused = reducedMotion.matches; syncPause(); });
syncPause();
const sliderTimer = setInterval(() => {
  if (!paused && !hovering && !document.hidden && !document.querySelector('dialog[open]') && !hero.contains(document.activeElement)) showSlide(slide + 1);
}, 5000);
fixImages();

// Delegated 3D tilt: mouse only; touch and reduced-motion users get stable cards.
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
let tiltFrame = 0;
grid.addEventListener('pointermove', event => {
  if (!finePointer.matches || reducedMotion.matches || event.pointerType !== 'mouse') return;
  const card = event.target.closest('.shop-product');
  if (!card) return;
  cancelAnimationFrame(tiltFrame);
  tiltFrame = requestAnimationFrame(() => {
    if (!card.isConnected) return;
    const box = card.getBoundingClientRect();
    const x = Math.max(-.5, Math.min(.5, (event.clientX - box.left) / box.width - .5));
    const y = Math.max(-.5, Math.min(.5, (event.clientY - box.top) / box.height - .5));
    card.style.setProperty('--rx', `${-y * 10}deg`);
    card.style.setProperty('--ry', `${x * 10}deg`);
  });
});
grid.addEventListener('pointerout', event => {
  const card = event.target.closest('.shop-product');
  if (card && !card.contains(event.relatedTarget)) {
    cancelAnimationFrame(tiltFrame);
    card.style.removeProperty('--rx');
    card.style.removeProperty('--ry');
  }
});

// Explicitly labeled demo notifications; no private order data is exposed.
const popup = document.querySelector('#fomo-popup');
const demoNames = ['Minh Anh', 'Hoàng Nam', 'Thảo Linh', 'Gia Huy', 'Ngọc Mai'];
let popupTimeout;
let fomoTimer = setInterval(() => {
  if (document.hidden || document.querySelector('dialog[open]') || !products.length) return;
  const name = demoNames[Math.floor(Math.random() * demoNames.length)];
  const product = products[Math.floor(Math.random() * products.length)];
  document.querySelector('#fomo-message').textContent = `${name} vừa đặt mua ${product.name}`;
  popup.hidden = false;
  clearTimeout(popupTimeout);
  popupTimeout = setTimeout(() => { popup.hidden = true; }, 6000);
}, 10000);
document.querySelector('#fomo-close').addEventListener('click', () => {
  popup.hidden = true;
  clearTimeout(popupTimeout);
  clearInterval(fomoTimer);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) popup.hidden = true; });
await loadProducts();


document.querySelector('#price-sort').addEventListener('change',render);
