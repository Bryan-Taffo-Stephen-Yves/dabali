-- Photos des plats du déjeuner et du dîner rapatriées dans public/dishes/ (plus de dépendance au stockage d'un projet)
update public.dishes d set photo_url = v.url, photo_credit = v.credit, photo_source = v.src from (values
  ('Alloco poulet braisé', '/dishes/alloco-poulet.jpg', null, null),
  ('Attiéké poisson braisé', '/dishes/attieke-poisson.jpg', 'Image générée par IA (Gamma) · illustration', null),
  ('Foutou banane sauce graine', '/dishes/foutou-sauce-graine.jpg', 'Photo : Fimalisa · CC BY-SA 4.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Foutou_%C3%A0_la_sauce_graine.JPG'),
  ('Garba', '/dishes/garba.jpg', 'Photo : Cyriac Gbogou · CC BY-SA 3.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Le_garba.jpg'),
  ('Placali sauce kplala', '/dishes/placali-kplala.jpg', 'Photo : Cyriac Gbogou · CC BY-SA 4.0 · Wikimedia Commons', 'https://commons.wikimedia.org/wiki/File:Placali_et_sauce.jpg'),
  ('Poulet frites', '/dishes/poulet-frites.jpg', 'Photo : Pexels · licence Pexels', 'https://www.pexels.com/photo/crispy-chicken-with-fries-sauce-and-salad-15390177/'),
  ('Riz sauce arachide poulet', '/dishes/riz-sauce-arachide.jpg', null, null),
  ('Riz sauce graine', '/dishes/riz-sauce-graine.jpg', null, null),
  ('Salade composée', '/dishes/salade-composee.jpg', 'Photo : Pexels', 'https://www.pexels.com/photo/bowl-of-vegetable-salad-406152/'),
  ('Spaghetti sautés', '/dishes/spaghetti-sautes.jpg', 'Photo : Pexels', 'https://www.pexels.com/photo/closeup-of-a-dish-with-noodles-14079234/')
) v(name, url, credit, src) where d.name = v.name;
