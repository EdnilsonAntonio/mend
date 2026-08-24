// Behavior A: login form submit
const loginForm = document.querySelector('#login-form');
if (loginForm) {
  loginForm.addEventListener('submit', function(event) {
    event.preventDefault();

    const emailInput = this.querySelector('input[type="email"]');
    const passwordInput = this.querySelector('input[type="password"]');

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    const loginStatus = document.querySelector('#login-status');

    if (email === '' || password === '') {
      loginStatus.textContent = 'Please enter both email and password.';
    } else {
      loginStatus.textContent = 'Signed in as ' + email;
    }
  });
}

// Behavior B: add to cart
const productCard = document.querySelector('#product-card');
if (productCard) {
  const addButton = productCard.querySelector('button');
  if (addButton) {
    addButton.addEventListener('click', function() {
      const cartCount = document.querySelector('#cart-count');
      const cartStatus = document.querySelector('#cart-status');

      if (cartCount && cartStatus) {
        const currentCount = parseInt(cartCount.textContent, 10);
        cartCount.textContent = currentCount + 1;
        cartStatus.textContent = 'Added Wireless Headphones to cart.';
      }
    });
  }
}
