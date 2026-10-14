// App entry point (architecture §1).
import '../ui/styles.css';
import { boot } from './boot';

const root = document.getElementById('app');
if (root) boot(root);
