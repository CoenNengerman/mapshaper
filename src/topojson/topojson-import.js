/* @requires topojson-common */

// Convert a TopoJSON topology into mapshaper's internal format
// Side-effect: data in topology is modified
//
MapShaper.importTopoJSON = function(topology, opts) {
  var layers = [],
      dataset, arcs;

  if (utils.isString(topology)) {
    topology = JSON.parse(topology);
  }

  if (topology.arcs && topology.arcs.length > 0) {
    // TODO: apply transform to ArcCollection, not input arcs
    if (topology.transform) {
      TopoJSON.decodeArcs(topology.arcs, topology.transform);
    }

    if (opts && opts.precision) {
      TopoJSON.roundCoords(topology.arcs, opts.precision);
    }

    arcs = new ArcCollection(topology.arcs);
  }

  utils.forEachProperty(topology.objects, function(object, name) {
    var lyr = TopoJSON.importObject(object, opts);

    if (MapShaper.layerHasPaths(lyr)) {
      MapShaper.cleanShapes(lyr.shapes, arcs, lyr.geometry_type);
    }

    lyr.name = name;
    layers.push(lyr);
  });

  dataset = {
    layers: layers,
    arcs: arcs,
    info: {}
  };

  MapShaper.importCRS(dataset, topology);

  return dataset;
};


TopoJSON.decodeArcs = function(arcs, transform) {
  var mx = transform.scale[0],
      my = transform.scale[1],
      bx = transform.translate[0],
      by = transform.translate[1];

  arcs.forEach(function(arc) {
    var prevX = 0,
        prevY = 0,
        xy, x, y;
    for (var i=0, len=arc.length; i<len; i++) {
      xy = arc[i];
      x = xy[0] + prevX;
      y = xy[1] + prevY;
      xy[0] = x * mx + bx;
      xy[1] = y * my + by;
      prevX = x;
      prevY = y;
    }
  });
};

// TODO: consider removing dupes...
TopoJSON.roundCoords = function(arcs, precision) {
  var round = getRoundingFunction(precision),
      p;
  arcs.forEach(function(arc) {
    for (var i=0, len=arc.length; i<len; i++) {
      p = arc[i];
      p[0] = round(p[0]);
      p[1] = round(p[1]);
    }
  });
};

TopoJSON.importObject = function(obj, opts) {
  if (obj.type != 'GeometryCollection') {
    obj = {
      type: "GeometryCollection",
      geometries: [obj]
    };
  }
  return TopoJSON.importGeometryCollection(obj, opts);
};

TopoJSON.importGeometryCollection = function(obj, opts) {
  var importer = new TopoJSON.GeometryImporter(opts);
  obj.geometries.forEach(importer.addGeometry, importer);
  return importer.done();
};

//
//
TopoJSON.GeometryImporter = function(opts) {
  var idField = opts && opts.id_field || GeoJSON.ID_FIELD,
      properties = [],
      shapes = [], // topological ids
      collectionType = null;

  this.addGeometry = function(geom) {
    var type = GeoJSON.translateGeoJSONType(geom.type),
        shapeId = shapes.length,
        rec = geom.properties,
        shape = null;

    if ('id' in geom) {
      rec = rec || {};
      rec[idField] = geom.id;
    }
    if (rec) {
      properties[shapeId] = rec;
    }
    if (type == 'point') {
      shape = this.importPointGeometry(geom);
    } else if (geom.type in TopoJSON.pathImporters) {
      shape = TopoJSON.pathImporters[geom.type](geom.arcs);
    } else {
      if (geom.type) {
        verbose("[TopoJSON] Unknown geometry type:", geom.type);
      }
      // null geometry -- ok
    }
    shapes.push(shape);
    this.updateCollectionType(type);
  };

  this.importPointGeometry = function(geom) {
    var shape = null;
    if (geom.type == 'Point') {
      shape = [geom.coordinates];
    } else if (geom.type == 'MultiPoint') {
      shape = geom.coordinates;
    } else {
      stop("Invalid TopoJSON point geometry:", geom);
    }
    return shape;
  };

  this.updateCollectionType = function(type) {
    if (!collectionType) {
      collectionType = type;
    } else if (type && collectionType != type) {
      collectionType = 'mixed';
    }
  };

  this.done = function() {
    var lyr = {};
    if (collectionType) {
      lyr.geometry_type = collectionType;
      lyr.shapes = shapes;
    }
    if (properties.length > 0) {
      lyr.data = new DataTable(properties);
    }
    return lyr;
  };
};

TopoJSON.pathImporters = {
  LineString: function(arcs) {
    return [arcs];
  },
  MultiLineString: function(arcs) {
    return arcs;
  },
  Polygon: function(arcs) {
    return arcs;
  },
  MultiPolygon: function(arcs) {
    return arcs.reduce(function(memo, arr) {
      return memo ? memo.concat(arr) : arr;
    }, null);
  }
};
