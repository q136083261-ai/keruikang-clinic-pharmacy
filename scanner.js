let barcodeStream=null,barcodeTimer=null;
const barcodeInput=document.getElementById("medicineBarcode"),scannerModal=document.getElementById("scannerModal"),barcodeVideo=document.getElementById("barcodeVideo"),scannerStatus=document.getElementById("scannerStatus");
function scannerToast(text){toast(text)}
function stopBarcodeScanner(){if(barcodeTimer){clearInterval(barcodeTimer);barcodeTimer=null}if(barcodeStream){barcodeStream.getTracks().forEach(t=>t.stop());barcodeStream=null}scannerModal.classList.remove("open");if(!document.querySelector(".modal.open:not(#scannerModal)"))document.getElementById("modalBackdrop").classList.remove("open")}
async function startBarcodeScanner(){
  if(!("BarcodeDetector" in window))return scannerToast("当前浏览器不支持摄像头识别，请使用 USB 扫码枪或手动输入");
  if(!navigator.mediaDevices?.getUserMedia)return scannerToast("当前环境无法调用摄像头，请使用扫码枪或手动输入");
  try{
    const formats=await BarcodeDetector.getSupportedFormats(),preferred=["ean_13","ean_8","upc_a","upc_e","code_128","code_39"].filter(x=>formats.includes(x)),detector=new BarcodeDetector({formats:preferred.length?preferred:formats});
    barcodeStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});barcodeVideo.srcObject=barcodeStream;scannerModal.classList.add("open");document.getElementById("modalBackdrop").classList.add("open");scannerStatus.textContent="正在识别，请将条形码放入扫描框内";
    barcodeTimer=setInterval(async()=>{try{const results=await detector.detect(barcodeVideo);if(results.length){barcodeInput.value=results[0].rawValue;barcodeInput.dispatchEvent(new Event("input",{bubbles:true}));stopBarcodeScanner();scannerToast("条形码已识别："+results[0].rawValue);document.getElementById("lookupBarcode").click()}}catch{}},450);
  }catch{scannerToast("摄像头无法使用，请检查授权或使用 USB 扫码枪");stopBarcodeScanner()}
}
document.getElementById("startBarcodeScanner").onclick=startBarcodeScanner;document.getElementById("stopBarcodeScanner").onclick=stopBarcodeScanner;
document.getElementById("modalBackdrop").addEventListener("click",()=>{if(scannerModal.classList.contains("open"))stopBarcodeScanner()});
barcodeInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();scannerToast("条形码已录入："+barcodeInput.value)}});
