// import protobufExport from './protobufExport.js';
import svgExport from './svgExport.js';

export function toSVG(scene, options) {
  options = options || {};
  let svg = svgExport(scene, { 
    printable: collectPrintable(),
    ...options
  });
  let blob = new Blob([svg], {type: "image/svg+xml"});
  let url = window.URL.createObjectURL(blob);
  let fileName = getFileName(options.name, '.svg');
  // For some reason, safari doesn't like when download happens on the same
  // event loop cycle. Pushing it to the next one.
  setTimeout(() => {
    let a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    revokeLater(url);
  }, 30)
}

export async function toPNG(scene, options) {
  options = options || {};
  let scale = Number.isFinite(options.scale) ? options.scale : 4;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const onComplete = typeof options.onComplete === 'function' ? options.onComplete : null;
  const skipDownload = options.skipDownload === true;

  notifyProgress(onProgress, 0, 'start');
  let fileName = getFileName(options.name, '.png');

  while (scale >= 1) {
    const printableCanvas = await getPrintableCanvas(scene, {scale, onProgress});
    const blob = await canvasToBlob(printableCanvas, 'image/png');
    if (blob) {
      const url = window.URL.createObjectURL(blob);
      if (!skipDownload) {
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        revokeLater(url);
      }
      if (onComplete) onComplete({blob, url, fileName});
      notifyProgress(onProgress, 100, 'done');
      return;
    }

    console.warn(`PNG export failed at scale ${scale}. Retrying with lower scale.`);
    scale = scale <= 1 ? 0 : Math.max(1, Math.floor(scale / 2));
  }

  notifyProgress(onProgress, 100, 'error');
  console.error('PNG export failed: canvas toBlob returned null at all scales');
}

export function getPrintableCanvas(scene, options) {
  options = options || {};
  const scale = Number.isFinite(options.scale) ? options.scale : 1;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  let cityCanvas = getCanvas();
  let width = cityCanvas.width * scale;
  let height = cityCanvas.height * scale;

  let printable = document.createElement('canvas');
  let ctx = printable.getContext('2d');
  printable.width = width;
  printable.height = height;
  scene.render();
  ctx.drawImage(cityCanvas, 0, 0, cityCanvas.width, cityCanvas.height, 0, 0, width, height);

  const labels = collectPrintable();
  notifyProgress(onProgress, 15, 'canvas');

  return drawLabels(labels, ctx, scale, onProgress).then(() => {
    notifyProgress(onProgress, 95, 'labels');
    return printable;
  });
}

export function getCanvas() {
  return document.querySelector('#canvas')
}

function getFileName(name, extension) {
  let fileName = escapeFileName(name || new Date().toISOString());
  return fileName + (extension || '');
}

function escapeFileName(str) {
  if (!str) return '';

  return str.replace(/[#%&{}\\/?*><$!'":@+`|=]/g, '_');
}


function drawTextLabel(element, ctx, scale) {
  if (!element) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let dpr = scale || 1;

    if (element.element instanceof SVGSVGElement) {
      let svg = element.element;
      let rect = element.bounds;
      let image = new Image();
      image.width = rect.width * dpr;
      image.height = rect.height * dpr;
      image.onload = () => {
        ctx.drawImage(image, rect.left * dpr, rect.top * dpr, image.width, image.height);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        resolve();
      };

      // Need to set width, otherwise firefox doesn't work: https://stackoverflow.com/questions/28690643/firefox-error-rendering-an-svg-image-to-html5-canvas-with-drawimage
      svg.setAttribute('width', image.width);
      svg.setAttribute('height', image.height);
      image.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg));
    } else {
      ctx.save();

      ctx.font = dpr * element.fontSize + 'px ' + element.fontFamily;
      ctx.fillStyle = element.color;
      ctx.textAlign = 'end'
      ctx.fillText(
        element.text, 
        (element.bounds.right - element.paddingRight) * dpr, 
        (element.bounds.bottom - element.paddingBottom) * dpr
      )
      ctx.restore();
      resolve();
    }
  });
}

function drawLabels(labels, ctx, scale, onProgress) {
  let count = labels.length;
  if (!count) return Promise.resolve();

  return labels.reduce((p, label, index) => {
    return p.then(() => {
      let percent = 15 + Math.round(((index + 1) / count) * 80);
      notifyProgress(onProgress, percent, 'labels');
      return drawTextLabel(label, ctx, scale);
    });
  }, Promise.resolve());
}

function collectPrintable() {
  return Array.from(document.querySelectorAll('.printable')).map(element => {
    let computedStyle = window.getComputedStyle(element);
    let bounds = element.getBoundingClientRect();
    let fontSize = Number.parseInt(computedStyle.fontSize, 10);
    let paddingRight = Number.parseInt(computedStyle.paddingRight, 10);
    // TODO: I don't know why I need to multiply by 2, it's just
    // not aligned right if I don't multiply. Need to figure out this.
    let paddingBottom = Number.parseInt(computedStyle.paddingBottom, 10) * 2;

    return {
      text: element.innerText,
      bounds,
      fontSize,
      paddingBottom,
      paddingRight,
      color: computedStyle.color,
      fontFamily: computedStyle.fontFamily,
      fill: computedStyle.color,
      element
    }
  });
}

function revokeLater(url) {
  // In iOS immediately revoked URLs cause "WebKitBlobResource error 1." error
  // Setting a timeout to revoke URL in the future fixes the error:
  setTimeout(() => {
    window.URL.revokeObjectURL(url);
  }, 45000);
}

function canvasToBlob(canvas, type) {
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob || null), type);
  });
}

function notifyProgress(handler, percent, stage) {
  if (!handler) return;
  handler({percent, stage});
}

// function toProtobuf() {
//   if (!lastGrid) return;

//   let arrayBuffer = protobufExport(lastGrid);
//   let blob = new Blob([arrayBuffer.buffer], {type: "application/octet-stream"});
//   let url = window.URL.createObjectURL(blob);
//   let a = document.createElement("a");
//   a.href = url;
//   a.download = lastGrid.id + '.pbf';
//   a.click();
//   revokeLater(url);
// }
