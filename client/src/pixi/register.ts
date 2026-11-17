/**
 * Registers the Pixi classes used as `<pixi*>` JSX elements. Importing this
 * module for its side effect (from `Board`) is enough for the whole tree.
 */
import { extend } from '@pixi/react';
import { Container, Graphics, Text } from 'pixi.js';

extend({ Container, Graphics, Text });
