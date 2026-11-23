// Replaces real people on live github.com pages (author names, avatars) with
// fictional ones before a screenshot, so store/marketing images show no
// personal data. Only touches the rendered page; nothing is sent anywhere.
const PEOPLE = [
  ['Ada Nowak', 'ada-n'],
  ['Leo Martin', 'leom'],
  ['Mia Kowalska', 'miakow'],
  ['Sam Rivera', 'samr'],
  ['Noor Haddad', 'noorh'],
  ['Tom Becker', 'tbecker'],
  ['Iris Lund', 'irisl'],
  ['Kai Moreno', 'kaim'],
];

async function anonymizePeople(page) {
  await page.evaluate((people) => {
    const pick = (i) => people[i % people.length];
    const initialsAvatar = (name, hue) =>
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="hsl(${hue} 45% 55%)"/>` +
          `<text x="20" y="25" font-family="sans-serif" font-size="15" font-weight="600" fill="#fff" text-anchor="middle">${name
            .split(' ')
            .map((p) => p[0])
            .join('')}</text></svg>`
      );
    const seen = new Map();
    const personFor = (key) => {
      if (!seen.has(key)) seen.set(key, pick(seen.size));
      return seen.get(key);
    };
    // PR list: "Full Name (login)" author links.
    document.querySelectorAll('[data-testid="author-filter-link"]').forEach((a) => {
      const [name, login] = personFor(a.textContent.trim());
      a.textContent = `${name} (${login})`;
      a.setAttribute('aria-label', `Filter by author ${name} (${login})`);
    });
    // Avatars anywhere on the page.
    document.querySelectorAll('img[src*="avatars.githubusercontent.com"]').forEach((img, i) => {
      const [name] = personFor(img.getAttribute('src'));
      img.src = initialsAvatar(name, (i * 67) % 360);
      img.removeAttribute('srcset');
    });
  }, PEOPLE);
}

module.exports = { anonymizePeople };
