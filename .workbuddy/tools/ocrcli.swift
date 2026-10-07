import Foundation
import Vision
import AppKit

// 用法: ocrcli <图片路径>  —— 输出 "x|y|w|h\t文本"（坐标为归一化 0~1，原点左上）
let args = CommandLine.arguments
guard args.count > 1 else { exit(2) }
for path in Array(args.dropFirst()) {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write(("SKIP \(path)\n").data(using: .utf8)!)
        continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["zh-Hans", "en-US"]
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { continue }
    guard let obs = req.results else { continue }
    // 按 y 降序（Vision 原点在左下）→ 转左上原点后按 y 升序、x 升序
    let rows = obs.compactMap { o -> (CGFloat, CGFloat, CGFloat, CGFloat, String)? in
        guard let c = o.topCandidates(1).first else { return nil }
        let b = o.boundingBox
        return (b.minX, 1.0 - b.maxY, b.width, b.height, c.string)
    }.sorted { a, b in
        if abs(a.1 - b.1) > 0.006 { return a.1 < b.1 }
        return a.0 < b.0
    }
    print("### \(path)")
    for r in rows {
        print(String(format: "%.3f|%.3f|%.3f|%.3f\t%@", r.0, r.1, r.2, r.3, r.4))
    }
}
