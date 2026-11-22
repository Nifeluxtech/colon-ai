document.getElementById('y').textContent = new Date().getFullYear();
document.getElementById('join').addEventListener('submit', function (e) {
  e.preventDefault();
  this.hidden = true;
  document.getElementById('ok').hidden = false;
});
