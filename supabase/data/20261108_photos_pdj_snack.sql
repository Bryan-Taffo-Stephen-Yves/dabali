-- Photos des plats du petit-déjeuner et du snack (Pexels, licence libre), servies depuis public/dishes/
update public.dishes d set photo_url = v.url, photo_credit = 'Photo : Pexels · licence Pexels', photo_source = v.src from (values
  ('Pain beurre & café au lait', '/dishes/pain-beurre-cafe.jpg', 'https://www.pexels.com/photo/spreading-butter-on-the-bread-15703465/'),
  ('Omelette pain', '/dishes/omelette-pain.jpg', 'https://www.pexels.com/photo/close-up-of-a-sandwich-cut-in-half-25049048/'),
  ('Bouillie de mil', '/dishes/bouillie-mil.jpg', 'https://www.pexels.com/photo/a-golden-spoon-in-a-bowl-of-oatmeal-4725748/'),
  ('Crêpes sucrées', '/dishes/crepes-sucrees.jpg', 'https://www.pexels.com/photo/crepes-with-strawberries-11653564/'),
  ('Brownie', '/dishes/brownie.jpg', 'https://www.pexels.com/photo/a-plate-of-brownies-4765839/'),
  ('Pain perdu', '/dishes/pain-perdu.jpg', 'https://www.pexels.com/photo/close-up-french-toast-with-strawberries-on-the-side-11577595/'),
  ('Croque-monsieur', '/dishes/croque-monsieur.jpg', 'https://www.pexels.com/photo/ham-and-cheese-toasts-15110224/')
) v(name, url, src) where d.name = v.name;
