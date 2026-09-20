# Contrat — l'eau bouge

Constat : l'application était **juste, mais immobile**. Un fond de rides tracé une fois, des cartes
qui entrent en cascade, et plus rien. Correcte, sobre, et un peu morte.

Ce contrat lui donne un souffle, sans rien casser de ce que le système de design a mis en place
(contrat phase8 §1) — et en particulier sans toucher à ses trois interdits : pas de dégradé
décoratif, pas de majuscules espacées, pas de cartes identiques empilées.

## 1. Le fond vit

Deux couches de rides, posées derrière tout le contenu, qui **dérivent lentement à des vitesses
différentes**.

Pourquoi deux : une couche seule qui glisse se lit comme un défilement. Deux, à des tailles et des
vitesses différentes, donnent la parallaxe — et c'est elle qui fait « de l'eau » plutôt que « un
motif qui bouge ». 64 s pour la couche proche, 110 s pour la lointaine, en sens inverse. Assez lent
pour qu'on ne le regarde jamais, assez vivant pour que l'écran ne soit pas mort.

Trois garanties, et elles ne sont pas négociables :

| | |
|---|---|
| **Rien ne se décale** | Couches `fixed`, hors flux, animées en `transform` seul : le compositeur s'en charge, la page n'est jamais remise en page. Le CLS mesuré reste à **0,0000** sur l'accueil et le profil. |
| **Rien ne se télécharge** | 0,3 ko de data-URI. Aucune requête, hors ligne compris. |
| **Rien ne bouge si on demande le calme** | Voir §3. |

La translation vaut exactement une tuile (120 px, 200 px) : la boucle est invisible. Le thème sombre
redessine **les deux** couches en clair — sans cela, la lointaine serait restée jade et aurait
dérivé invisible.

## 2. Le seul mouvement qui sert

Sur la carte du parcours, le nœud de l'étape du jour émet une onde qui s'écarte et s'efface, comme
une goutte sur l'eau.

Ce n'est pas de la décoration : c'est la réponse à « je fais quoi maintenant ? », donnée à l'œil
avant d'être lue. L'onde part d'un calque posé **derrière** le nœud — elle ne le grossit pas, ne
décale rien et n'intercepte aucun toucher (`pointer-events: none`, `aria-hidden`).

C'est le seul élément animé en boucle du contenu. La règle de phase8 §1 — *un seul moment héroïque
par écran* — tient : le fond n'est pas du contenu, et l'onde est ce moment-là.

S'y ajoute un accusé de réception ponctuel : le cœur des favoris fait une pulsation **une fois**
quand on aime, jamais quand une liste déjà pleine de cœurs s'affiche.

## 3. Le calme se respecte vraiment

`app.css` ramène toute durée d'animation à 1 ms sous `prefers-reduced-motion`. Sur une animation
**finie**, c'est exactement ce qu'on veut : elle se pose instantanément.

Sur une animation **infinie**, c'est un défaut : mille tours par seconde, du calcul pour rien, et un
scintillement offert à qui vient précisément de demander le calme. Il existait déjà avec le reflet
des squelettes (`parlo-shimmer`).

Les boucles sont donc explicitement **arrêtées**, pas accélérées :

```css
body::before, body::after, .parlo-shimmer, .parlo-ripple { animation: none !important; }
```

## 4. Ce qui est vérifié

`apps/web/e2e/design.spec.ts`, aux deux gabarits de référence :

- **aucune animation longue ne tourne** sous `prefers-reduced-motion` — le test lit
  `document.getAnimations()` et refuse toute durée supérieure à 1 ms ;
- **CLS ≤ 0,05** sur l'accueil, le parcours, réviser, le profil et une leçon (mesuré : 0,0000) ;
- **aucun débordement horizontal** : les couches débordent d'une tuile de chaque côté, en `fixed`,
  donc elles n'entrent pas dans `scrollWidth` ;
- **contraste AA** inchangé : les couches sont à 2,5 % et 4 % d'opacité, derrière un fond opaque.
