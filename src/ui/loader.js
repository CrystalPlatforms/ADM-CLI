// Dots_12 braille loader — self-contained clone (no external library).
// Keyframes taken from cli-loaders (https://github.com/cbmongithub/cli-loaders, MIT),
// originally based on cli-spinners by sindresorhus (MIT).

const FRAMES = '⢀⠀,⡀⠀,⠄⠀,⢂⠀,⡂⠀,⠅⠀,⢃⠀,⡃⠀,⠍⠀,⢋⠀,⡋⠀,⠍⠁,⢋⠁,⡋⠁,⠍⠉,⠋⠉,⠋⠉,⠉⠙,⠉⠙,⠉⠩,⠈⢙,⠈⡙,⢈⠩,⡀⢙,⠄⡙,⢂⠩,⡂⢘,⠅⡘,⢃⠨,⡃⢐,⠍⡐,⢋⠠,⡋⢀,⠍⡁,⢋⠁,⡋⠁,⠍⠉,⠋⠉,⠋⠉,⠉⠙,⠉⠙,⠉⠩,⠈⢙,⠈⡙,⠈⠩,⠀⢙,⠀⡙,⠀⠩,⠀⢘,⠀⡘,⠀⠨,⠀⢐,⠀⡐,⠀⠠,⠀⢀,⠀⡀'.split(',');

const DEFAULT_SPEED_MS = 80;

// Plain-terminal spinner. Returns a handle with stop([finalMessage]).
// Example:
//   const { startLoader } = require('./ui/loader');
//   const loader = startLoader({ text: 'scanning tools…' });
//   // …work…
//   loader.stop('done');
function startLoader({ speed = DEFAULT_SPEED_MS, stream = process.stdout, text = '' } = {}) {
  let frame = 0;
  const CLEAR_LINE = '\u001B[K';
  const HIDE_CURSOR = '\u001B[?25l';
  const SHOW_CURSOR = '\u001B[?25h';

  stream.write(HIDE_CURSOR);
  const draw = () => {
    const f = FRAMES[frame];
    frame = (frame + 1) % FRAMES.length;
    stream.write(`\r${f} ${text}${CLEAR_LINE}`);
  };
  draw();

  const timer = setInterval(draw, speed);

  return {
    frames: FRAMES,
    setText(newText) {
      text = newText;
    },
    stop(finalMessage = '') {
      clearInterval(timer);
      stream.write(`\r${CLEAR_LINE}${finalMessage ? finalMessage + '\n' : ''}${SHOW_CURSOR}`);
    },
  };
}

module.exports = { FRAMES, DEFAULT_SPEED_MS, startLoader };
