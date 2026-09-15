import {createUI as createStableUI} from './ui.js';
import {attachSpectatorInsights} from './ui-spectator-insights.js';

export function createUI(W,R,D,E,C,A,settings,saveSettings){
  return attachSpectatorInsights(createStableUI(W,R,D,E,C,A,settings,saveSettings),R,D);
}
