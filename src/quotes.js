// [Latin, Vietnamese, source]
const QUOTES = [
  ['Scientia potentia est.', 'Tri thức là sức mạnh.', 'Francis Bacon'],
  ['Docendo discimus.', 'Dạy người khác, ta cũng học được.', 'Seneca'],
  ['Sapere aude.', 'Hãy dám hiểu biết.', 'Horatius'],
  ['Verba volant, scripta manent.', 'Lời nói bay đi, chữ viết ở lại.', 'Ngạn ngữ Latin'],
  ['Nosce te ipsum.', 'Hãy biết chính mình.', 'Đền Delphi'],
  ['Qui docet, discit.', 'Người dạy cũng là người học.', 'Ngạn ngữ Latin'],
  ['Per aspera ad astra.', 'Qua gian nan để tới những vì sao.', 'Ngạn ngữ Latin'],
];

export function startQuotes(interval = 8000) {
  const box = document.getElementById('quote');
  const latin = document.getElementById('quote-text');
  const translation = document.getElementById('quote-vi');
  const source = document.getElementById('quote-author');
  let i = Math.floor(Math.random() * QUOTES.length);

  const show = () => {
    [latin.textContent, translation.textContent, source.textContent] = QUOTES[i];
    box.classList.remove('hidden');
  };

  show();
  setInterval(() => {
    box.classList.add('hidden');
    setTimeout(() => {
      i = (i + 1) % QUOTES.length;
      show();
    }, 1500);
  }, interval);
}
